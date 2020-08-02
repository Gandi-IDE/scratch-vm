const log = require('../util/log');
const Cast = require('../util/cast');
const VariablePool = require('./variable-pool');
const execute = require('./execute');

/* eslint-disable max-len */

const sanitize = string => string
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');

const TYPE_NUMBER = 1;
const TYPE_STRING = 2;
const TYPE_BOOLEAN = 3;
const TYPE_UNKNOWN = 4;
const TYPE_NUMBER_NAN = 5;

const disableToString = obj => {
    obj.toString = () => {
        throw new Error(`toString unexpectedly called on ${obj.name || 'object'}`);
    };
};

const pen = 'runtime.ext_pen';
const penState = `${pen}._getPenState(target)`;

/**
 * Variable pool used for factory function names.
 */
const factoryNameVariablePool = new VariablePool('f');

/**
 * Variable pool used for generated script names.
 */
const generatorNameVariablePool = new VariablePool('g');

/**
 * @typedef Input
 * @property {() => string} asNumber
 * @property {() => string} asString
 * @property {() => string} asBoolean
 * @property {() => string} asUnknown
 */

/**
 * @implements {Input}
 */
class TypedInput {
    constructor (source, type) {
        // for debugging
        if (typeof type !== 'number') throw new Error('type is invalid');
        /** @private */
        this.source = source;
        /** @private */
        this.type = type;
    }

    asNumber () {
        if (this.type === TYPE_NUMBER) return this.source;
        if (this.type === TYPE_NUMBER_NAN) return `(${this.source} || 0)`;
        return `(+${this.source} || 0)`;
    }

    asString () {
        if (this.type === TYPE_STRING) return this.source;
        return `("" + ${this.source})`;
    }

    asBoolean () {
        if (this.type === TYPE_BOOLEAN) return this.source;
        return `toBoolean(${this.source})`;
    }

    asUnknown () {
        return this.source;
    }
}

/**
 * @implements {Input}
 */
class ConstantInput {
    constructor (constantValue) {
        this.constantValue = constantValue;
    }

    asNumber () {
        // Compute at compilation time
        const numberValue = +this.constantValue;
        if (numberValue) {
            return this.constantValue;
        }
        return '0';
    }

    asString () {
        return `"${sanitize('' + this.constantValue)}"`;
    }

    asBoolean () {
        // Compute at compilation time
        return Cast.toBoolean(this.constantValue).toString();
    }

    asUnknown () {
        // Attempt to convert strings to numbers, if it is unlikely to break things
        if (typeof this.constantValue === 'number') {
            // todo: handle NaN?
            return this.constantValue;
        }
        const numberValue = +this.constantValue;
        if (numberValue.toString() === this.constantValue) {
            return this.constantValue;
        }
        return this.asString();
    }
}

class ScriptCompiler {
    constructor (script, ast, target) {
        this.script = script;
        this.ast = ast;
        this.target = target;
        this.source = '';
        this.localVariables = new VariablePool('a');
        this._setupVariablesPool = new VariablePool('b');
        this._setupVariables = {};
    }

    /**
     * @param {object} node Input node to compile.
     * @returns {Input} Compiled input.
     */
    descendInput (node) {
        switch (node.kind) {
        case 'args.boolean':
            return new TypedInput(`toBoolean(C["${sanitize(node.name)}"])`, TYPE_BOOLEAN);
        case 'args.stringNumber':
            return new TypedInput(`C["${sanitize(node.name)}"]`, TYPE_UNKNOWN);

        case 'compat':
            return new TypedInput(`(${this.generateCompatCall(node)})`, TYPE_UNKNOWN);

        case 'constant':
            return this.safeConstantInput(node.value);

        case 'list.contains':
            return new TypedInput(`listContains(${this.referenceVariable(node.list)}, ${this.descendInput(node.item).asUnknown()})`, TYPE_BOOLEAN);
        case 'list.contents':
            return new TypedInput(`listContents(${this.referenceVariable(node.list)})`, TYPE_STRING);
        case 'list.get':
            return new TypedInput(`listGet(${this.referenceVariable(node.list)}, ${this.descendInput(node.index).asUnknown()})`, TYPE_UNKNOWN);
        case 'list.indexOf':
            return new TypedInput(`listIndexOf(${this.referenceVariable(node.list)}, ${this.descendInput(node.item).asUnknown()})`, TYPE_NUMBER);
        case 'list.length':
            return new TypedInput(`${this.referenceVariable(node.list)}.value.length`, TYPE_NUMBER);

        case 'looks.size':
            return new TypedInput('target.size', TYPE_NUMBER);
        case 'looks.backdropName':
            return new TypedInput('stage.getCostumes()[stage.currentCostume].name', TYPE_STRING);
        case 'looks.backdropNumber':
            return new TypedInput('(stage.currentCostume + 1)', TYPE_NUMBER);
        case 'looks.costumeName':
            return new TypedInput('target.getCostumes()[target.currentCostume].name', TYPE_STRING);
        case 'looks.costumeNumber':
            return new TypedInput('(target.currentCostume + 1)', TYPE_NUMBER);
    
        case 'motion.direction':
            return new TypedInput('target.direction', TYPE_NUMBER);
        case 'motion.x':
            return new TypedInput('target.x', TYPE_NUMBER);
        case 'motion.y':
            return new TypedInput('target.y', TYPE_NUMBER);

        case 'op.abs':
            return new TypedInput(`Math.abs(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.acos':
            return new TypedInput(`((Math.acos(${this.descendInput(node.value).asNumber()}) * 180) / Math.PI)`, TYPE_NUMBER);
        case 'op.add':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} + ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
        case 'op.and':
            return new TypedInput(`(${this.descendInput(node.left).asBoolean()} && ${this.descendInput(node.right).asBoolean()})`, TYPE_BOOLEAN);
        case 'op.asin':
            return new TypedInput(`((Math.asin(${this.descendInput(node.value).asNumber()}) * 180) / Math.PI)`, TYPE_NUMBER);
        case 'op.atan':
            return new TypedInput(`((Math.atan(${this.descendInput(node.value).asNumber()}) * 180) / Math.PI)`, TYPE_NUMBER);
        case 'op.ceiling':
            return new TypedInput(`Math.ceil(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.contains':
            return new TypedInput(`(${this.descendInput(node.string).asString()}.toLowerCase().indexOf(${this.descendInput(node.contains).asString()}.toLowerCase()) !== -1)`);
        case 'op.cos':
            return new TypedInput(`(Math.round(Math.cos((Math.PI * ${this.descendInput(node.value).asNumber()}) / 180) * 1e10) / 1e10)`, TYPE_NUMBER);
        case 'op.divide':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} / ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER_NAN);
        case 'op.equals':
            return new TypedInput(`compareEqual(${this.descendInput(node.left).asUnknown()}, ${this.descendInput(node.right).asUnknown()})`, TYPE_BOOLEAN);
        case 'op.e^':
            return new TypedInput(`Math.exp(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.floor':
            return new TypedInput(`Math.floor(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.greater':
            return new TypedInput(`compareGreaterThan(${this.descendInput(node.left).asUnknown()}, ${this.descendInput(node.right).asUnknown()})`, TYPE_BOOLEAN);
        case 'op.join':
            return new TypedInput(`(${this.descendInput(node.left).asString()} + ${this.descendInput(node.right).asString()})`, TYPE_STRING);
        case 'op.length':
            return new TypedInput(`${this.descendInput(node.string).asString()}.length`, TYPE_NUMBER);
        case 'op.less':
            return new TypedInput(`compareLessThan(${this.descendInput(node.left).asUnknown()}, ${this.descendInput(node.right).asUnknown()})`, TYPE_BOOLEAN);
        case 'op.letterOf':
            return new TypedInput(`((${this.descendInput(node.string).asString()})[(${this.descendInput(node.letter).asNumber()} | 0) - 1] || "")`, TYPE_STRING);
        case 'op.ln':
            return new TypedInput(`Math.log(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.log':
            return new TypedInput(`(Math.log(${this.descendInput(node.value).asNumber()}) / Math.LN10)`, TYPE_NUMBER);
        case 'op.mod':
            return new TypedInput(`mod(${this.descendInput(node.left).asNumber()}, ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
        case 'op.multiply':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} * ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
        case 'op.not':
            return new TypedInput(`!${this.descendInput(node.operand).asBoolean()}`, TYPE_BOOLEAN);
        case 'op.or':
            return new TypedInput(`(${this.descendInput(node.left).asBoolean()} || ${this.descendInput(node.right).asBoolean()})`, TYPE_BOOLEAN);
        case 'op.random':
            if (node.useInts) {
                return new TypedInput(`randomInt(${this.descendInput(node.low).asNumber()}, ${this.descendInput(node.high).asNumber()})`, TYPE_NUMBER);
            }
            if (node.useFloats) {
                return new TypedInput(`randomFloat(${this.descendInput(node.low).asNumber()}, ${this.descendInput(node.high).asNumber()})`, TYPE_NUMBER);
            }
            return new TypedInput(`runtime.ext_scratch3_operators._random(${this.descendInput(node.low).asUnknown()}, ${this.descendInput(node.high).asUnknown()})`, TYPE_NUMBER);
        case 'op.round':
            return new TypedInput(`Math.round(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.sin':
            return new TypedInput(`(Math.round(Math.sin((Math.PI * ${this.descendInput(node.value).asNumber()}) / 180) * 1e10) / 1e10)`, TYPE_NUMBER);
        case 'op.sqrt':
            return new TypedInput(`Math.sqrt(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER_NAN);
        case 'op.subtract':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} - ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
        case 'op.tan':
            return new TypedInput(`Math.tan(${this.descendInput(node.value).asNumber()} * Math.PI / 180)`, TYPE_NUMBER);
        case 'op.10^':
            return new TypedInput(`Math.pow(10, ${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);

        case 'sensing.colorTouchingColor':
            return new TypedInput(`target.colorIsTouchingColor(colorToList(${this.descendInput(node.target).asUnknown()}), colorToList(${this.descendInput(node.mask).asUnknown()}))`, TYPE_BOOLEAN);
        case 'sensing.timer':
            return new TypedInput('ioQuery("clock", "projectTimer")', TYPE_NUMBER);
        case 'sensing.keydown':
            return new TypedInput(`ioQuery("keyboard", "getKeyIsDown", [${this.descendInput(node.key).asUnknown()}])`, TYPE_BOOLEAN);
        case 'sensing.mousedown':
            return new TypedInput('ioQuery("mouse", "getIsDown")', TYPE_BOOLEAN);
        case 'sensing.mouseX':
            return new TypedInput('ioQuery("mouse", "getScratchX")', TYPE_NUMBER);
        case 'sensing.mouseY':
            return new TypedInput('ioQuery("mouse", "getScratchY")', TYPE_NUMBER);
        case 'sensing.touching':
            return new TypedInput(`target.isTouchingObject(${this.descendInput(node.object).asUnknown()})`, TYPE_BOOLEAN);
        case 'sensing.touchingColor':
            return new TypedInput(`target.isTouchingColor(colorToList(${this.descendInput(node.color).asUnknown()}))`, TYPE_BOOLEAN);
        case 'sensing.username':
            return new TypedInput('ioQuery("userData", "getUsername")', TYPE_STRING);

        case 'var.get':
            return new TypedInput(`${this.referenceVariable(node.variable)}.value`, TYPE_UNKNOWN);

        default:
            log.warn(`JS: Unknown input: ${node.kind}`, node);
            throw new Error(`JS: Unknown input: ${node.kind}`);
        }
    }

    /**
     * @param {*} node Stacked node to compile.
     */
    descendStackedBlock (node) {
        switch (node.kind) {
        case 'compat':
            this.source += this.generateCompatCall(node);
            this.source += ';\n';
            break;

        case 'control.createClone':
            this.source += `runtime.ext_scratch3_control._createClone(${this.descendInput(node.target).asString()}, target);\n`;
            break;
        case 'control.deleteClone':
            this.source += 'if (!target.isOriginal) {\n';
            this.source += '  runtime.disposeTarget(target);\n';
            this.source += '  runtime.stopForTarget(target);\n';
            this.retire();
            this.source += '}\n';
            break;
        case 'control.for': {
            const index = this.localVariables.next();
            this.source += `var ${index} = 0; `;
            this.source += `while (${index} < ${this.descendInput(node.count).asNumber()}) { `;
            this.source += `${index}++; `;
            this.source += `${this.referenceVariable(node.variable)}.value = ${index};\n`;
            this.descendStack(node.do);
            this.source += '}\n';
            break;
        }
        case 'control.if':
            this.source += `if (${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.descendStack(node.whenTrue);
            // only add the else branch if it won't be empty
            // this makes scripts have a bit less useless noise in them
            if (node.whenFalse.length) {
                this.source += `} else {\n`;
                this.descendStack(node.whenFalse);
            }
            this.source += `}\n`;
            break;
        case 'control.repeat': {
            const i = this.localVariables.next();
            this.source += `for (var ${i} = ${this.descendInput(node.times).asNumber()}; ${i} >= 0.5; ${i}--) {\n`;
            this.descendStack(node.do);
            this.yieldNotWarp();
            this.source += `}\n`;
            break;
        }
        case 'control.stop': {
            if (node.level === 'all') {
                this.source += 'runtime.stopAll();\n';
                this.retire();
            } else if (node.level === 'other scripts in sprite' || node.level === 'other scripts in stage') {
                this.source += 'runtime.stopForTarget(target, thread);\n';
            } else if (node.level === 'this script') {
                if (this.script.isProcedure) {
                    if (this.script.isWarp) {
                        this.source += 'thread.warp--;\n';
                    }
                    this.source += 'return;\n';
                } else {
                    this.retire();
                }
            }
            break;
        }
        case 'control.wait': {
            const timer = this.localVariables.next();
            const duration = this.localVariables.next();
            // todo: yield after setting up timer, duration
            this.yieldNotWarp();
            this.source += `var ${timer} = timer();\n`;
            this.source += `var ${duration} = Math.max(0, 1000 * ${this.descendInput(node.seconds).asNumber()});\n`;
            this.source += `while (${timer}.timeElapsed() < ${duration}) {\n`;
            this.yieldNotWarp();
            this.source += '}\n';
            break;
        }
        case 'control.waitUntil': {
            this.source += `while (!${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.yieldNotWarp();
            this.source += `}\n`;
            break;
        }
        case 'control.while':
            this.source += `while (${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.descendStack(node.do);
            this.yieldNotWarp();
            this.source += `}\n`;
            break;

        case 'event.broadcast':
            this.source += `startHats("event_whenbroadcastreceived", { BROADCAST_OPTION: ${this.descendInput(node.broadcast).asString()} });\n`;
            break;
        case 'event.broadcastAndWait':
            this.source += `yield* waitThreads(startHats("event_whenbroadcastreceived", { BROADCAST_OPTION: ${this.descendInput(node.broadcast).asString()} }));\n`;
            break;

        case 'list.add': {
            const list = this.referenceVariable(node.list);
            this.source += `${list}._monitorUpToDate = false;\n`;
            break;
        }
        case 'list.delete':
            this.source += `listDelete(${this.referenceVariable(node.list)}, ${this.descendInput(node.index).asUnknown()});\n`;
            break;
        case 'list.deleteAll':
            this.source += `${this.referenceVariable(node.list)}.value = [];\n`;
            break;
        case 'list.hide':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.list.id)}", element: "checkbox", value: false }, runtime);\n`;
            break;
        case 'list.insert':
            this.source += `listInsert(${this.referenceVariable(node.list)}, ${this.descendInput(node.index).asUnknown()}, ${this.descendInput(node.item).asUnknown()});\n`;
            break;
        case 'list.replace':
            this.source += `listReplace(${this.referenceVariable(node.list)}, ${this.descendInput(node.index).asUnknown()}, ${this.descendInput(node.item).asUnknown()});\n`;
            break;
        case 'list.show':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.list.id)}", element: "checkbox", value: true }, runtime);\n`;
            break;

        case 'looks.backwardLayers':
            this.source += `target.goBackwardLayers(${this.descendInput(node.layers).asNumber()});\n`;
            break;
        case 'looks.clearEffects':
            this.source += 'target.clearEffects();\n';
            break;
        case 'looks.forwardLayers':
            this.source += `target.goForwardLayers(${this.descendInput(node.layers).asNumber()});\n`;
            break;
        case 'looks.goToBack':
            this.source += 'target.goToBack();\n';
            break;
        case 'looks.goToFront':
            this.source += 'target.goToFront();\n';
            break;
        case 'looks.hide':
            this.source += 'target.setVisible(false);\n';
            this.source += 'runtime.ext_scratch3_looks._renderBubble(target);\n';
            break;
        case 'looks.setSize':
            this.source += `target.setSize(${this.descendInput(node.size).asNumber()});\n`;
            break;
        case 'looks.show':
            this.source += 'target.setVisible(true);\n';
            this.source += 'runtime.ext_scratch3_looks._renderBubble(target);\n';
            break;
        case 'looks.switchBackdrop':
            this.source += `runtime.ext_scratch3_looks._setBackdrop(stage, ${this.descendInput(node.backdrop).asUnknown()});\n`;
            break;
        case 'looks.switchCostume':
            this.source += `runtime.ext_scratch3_looks._setCostume(target, ${this.descendInput(node.costume).asUnknown()});\n`;
            break;

        case 'motion.ifOnEdgeBounce':
            this.source += `runtime.ext_scratch3_motion._ifOnEdgeBounce(target);\n`;
            break;
        case 'motion.setDirection':
            this.source += `target.setDirection(${this.descendInput(node.direction).asNumber()});\n`;
            break;
        case 'motion.setRotationStyle':
            this.source += `target.setRotationStyle("${sanitize(node.style)}");\n`;
            break;
        case 'motion.setXY':
            this.source += `target.setXY(${this.descendInput(node.x).asNumber()}, ${this.descendInput(node.y).asNumber()});\n`;
            break;
        case 'motion.step':
            this.source += `runtime.ext_scratch3_motion._moveSteps(${this.descendInput(node.steps).asNumber()}, target);\n`;
            break;

        case 'pen.clear':
            this.source += `${pen}.clear();\n`;
            break;
        case 'pen.down':
            this.source += `${pen}._penDown(target);\n`;
            break;
        case 'pen.changeParam':
            this.source += `${pen}._setOrChangeColorParam(${this.descendInput(node.param).asString()}, ${this.descendInput(node.value).asNumber()}, ${penState}, true);\n`;
            break;
        case 'pen.changeSize':
            this.source += `${pen}._changePenSizeBy(${this.descendInput(node.size).asNumber()}, target);\n`;
            break;
        case 'pen.legacyChangeHue':
            this.source += `${pen}._changePenHueBy(${this.descendInput(node.hue).asNumber()}, target);\n`;
            break;
        case 'pen.legacyChangeShade':
            this.source += `${pen}._changePenShadeBy(${this.descendInput(node.shade).asNumber()}, target);\n`;
            break;
        case 'pen.legacySetHue':
            this.source += `${pen}._setPenHueToNumber(${this.descendInput(node.hue).asNumber()}, target);\n`;
            break;
        case 'pen.legacySetShade':
            this.source += `${pen}._setPenShadeToNumber(${this.descendInput(node.shade).asNumber()}, target);\n`;
            break;
        case 'pen.setColor':
            this.source += `${pen}._setPenColorToColor(${this.descendInput(node.color).asUnknown()}, target);\n`;
            break;
        case 'pen.setParam':
            this.source += `${pen}._setOrChangeColorParam(${this.descendInput(node.param).asString()}, ${this.descendInput(node.value).asNumber()}, ${penState}, false);\n`;
            break;
        case 'pen.setSize':
            this.source += `${pen}._setPenSizeTo(${this.descendInput(node.size).asNumber()}, target);\n`;
            break;
        case 'pen.stamp':
            this.source += `${pen}._stamp(target);\n`;
            break;
        case 'pen.up':
            this.source += `${pen}._penUp(target);\n`;
            break;

        case 'procedures.call': {
            const procedureCode = node.code;
            // Do not generate any code for empty procedures.
            const procedureData = this.ast.procedures[procedureCode];
            if (procedureData.stack === null) {
                break;
            }
            this.source += `yield* thread.procedures["${sanitize(procedureCode)}"](`;
            // Only include arguments if the procedure accepts any.
            if (procedureData.hasArguments) {
                this.source += '{';
                for (const name of Object.keys(node.parameters)) {
                    this.source += `"${sanitize(name)}":${this.descendInput(node.parameters[name]).asUnknown()},`;
                }
                this.source += '}';
            }
            this.source += `);\n`;
            break;
        }

        case 'sensing.resetTimer':
            this.source += 'ioQuery("clock", "resetProjectTimer");\n';
            break;

        case 'var.change': {
            const variable = this.referenceVariable(node.variable);
            this.source += `${variable}.value = (+${variable}.value || 0) + ${this.descendInput(node.value).asNumber()};\n`;
            if (node.variable.isCloud) {
                this.source += `ioQuery("cloud", "requestUpdateVariable", ["${sanitize(node.variable.name)}", ${variable}.value]);\n`;
            }
            break;
        }
        case 'var.hide':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.variable.id)}", element: "checkbox", value: false }, runtime);\n`;
            break;
        case 'var.set': {
            const variable = this.referenceVariable(node.variable);
            this.source += `${variable}.value = ${this.descendInput(node.value).asUnknown()};\n`;
            if (node.variable.isCloud) {
                this.source += `ioQuery("cloud", "requestUpdateVariable", ["${sanitize(node.variable.name)}", ${variable}.value]);\n`;
            }
            break;
        }
        case 'var.show':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.variable.id)}", element: "checkbox", value: true }, runtime);\n`;
            break;

        default:
            log.warn(`JS: Unknown stacked block: ${node.kind}`, node);
            throw new Error(`JS: Unknown stacked block: ${node.kind}`);
        }
    }

    descendStack (nodes) {
        for (const node of nodes) {
            this.descendStackedBlock(node);
        }
    }

    referenceVariable (variable) {
        if (variable.scope === 'target') {
            return this.evaluateOnce(`target.variables["${sanitize(variable.id)}"]`);
        }
        return this.evaluateOnce(`stage.variables["${sanitize(variable.id)}"]`);
    }

    evaluateOnce (source) {
        if (this._setupVariables.hasOwnProperty(source)) {
            return this._setupVariables[source];
        }
        const variable = this._setupVariablesPool.next();
        this._setupVariables[source] = variable;
        return variable;
    }

    retire () {
        this.source += 'retire(); yield;\n';
    }

    yieldNotWarp () {
        if (!this.script.isWarp) {
            this.source += 'if (thread.warp === 0) yield;\n';
        }
    }

    safeConstantInput (value) {
        if (typeof value === 'string') {
            if (this.isNameOfCostume(value)) {
                return new TypedInput(`"${sanitize(value)}"`, TYPE_STRING);
            }
        }
        return new ConstantInput(value);
    }

    isNameOfCostume (stringValue) {
        // todo: also check backdrop
        return this.target.getCostumeIndexByName(stringValue) !== -1;
    }

    generateCompatCall (node) {
        const opcode = node.opcode;

        let result = `/* ${opcode} */ yield* executeInCompatibilityLayer({`;

        for (const inputName of Object.keys(node.inputs)) {
            const input = node.inputs[inputName];
            const compiledInput = this.descendInput(input).asUnknown();
            result += `"${sanitize(inputName)}":${compiledInput},`;
        }
        for (const fieldName of Object.keys(node.fields)) {
            const field = node.fields[fieldName];
            result += `"${sanitize(fieldName)}":"${sanitize(field)}",`;
        }
        result += `}, runtime.getOpcodeFunction("${sanitize(opcode)}"))`;

        return result;
    }

    createScriptFactory () {
        const scriptName = generatorNameVariablePool.next();
        const factoryName = factoryNameVariablePool.next();

        let script = '';

        // Factory
        script += `(function ${factoryName}(target) { `;
        script += 'const runtime = target.runtime; ';
        script += 'const stage = runtime.getTargetForStage();\n';
        for (const varValue of Object.keys(this._setupVariables)) {
            const varName = this._setupVariables[varValue];
            script += `const ${varName} = ${varValue};\n`;
        }

        // Generated script
        script += `return function* ${scriptName}(`;
        if (this.script.hasArguments) {
            script += 'C';
        }
        script += ') {\n';

        if (this.script.isWarp) {
            script += 'thread.warp++;\n';
        }

        script += this.source;

        if (!this.script.isProcedure) {
            script += 'retire();\n';
        } else if (this.script.isWarp) {
            script += 'thread.warp--;\n';
        }

        script += '}; })';

        return script;
    }

    compile () {
        if (this.script.stack) {
            this.descendStack(this.script.stack);
        }

        const factory = this.createScriptFactory();
        const fn = execute.scopedEval(factory);
        log.info(`JS: compiled script`, factory);

        return fn;
    }
}

disableToString(ConstantInput.prototype);
disableToString(ConstantInput.prototype.asNumber);
disableToString(ConstantInput.prototype.asString);
disableToString(ConstantInput.prototype.asBoolean);
disableToString(ConstantInput.prototype.asUnknown);
disableToString(TypedInput.prototype);
disableToString(TypedInput.prototype.asNumber);
disableToString(TypedInput.prototype.asString);
disableToString(TypedInput.prototype.asBoolean);
disableToString(TypedInput.prototype.asUnknown);

class JSCompiler {
    constructor (ast, target) {
        this.ast = ast;
        this.target = target;
        this.compilingProcedures = [];
        this.compiledProcedures = {};
    }

    compileTree (script) {
        for (const procedureCode of script.dependedProcedures) {
            if (this.compiledProcedures.hasOwnProperty(procedureCode)) {
                // Already compiled
                continue;
            }
            if (this.compilingProcedures.includes(procedureCode)) {
                // Being compiled, most likely circular dependencies
                continue;
            }

            this.compilingProcedures.push(procedureCode);

            const procedureRoot = this.ast.procedures[procedureCode];
            const procedureTree = this.compileTree(procedureRoot);
            this.compiledProcedures[procedureCode] = procedureTree;

            this.compilingProcedures.pop();
        }

        const compiler = new ScriptCompiler(script, this.ast, this.target);
        return compiler.compile();
    }

    compile () {
        const entry = this.compileTree(this.ast.entry);

        return {
            startingFunction: entry,
            procedures: this.compiledProcedures
        };
    }
}

module.exports = JSCompiler;
