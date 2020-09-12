const log = require('../util/log');
const Cast = require('../util/cast');
const VariablePool = require('./variable-pool');
const execute = require('./execute');
const {disableToString} = require('./util');
const environment = require('./environment');

/* eslint-disable max-len */

const sanitize = string => {
    if (typeof string === 'string') {
        return JSON.stringify(string).slice(1, -1);
    }
    throw new Error(`sanitize got unexpected type: ${typeof string}`);
};

const TYPE_NUMBER = 1;
const TYPE_STRING = 2;
const TYPE_BOOLEAN = 3;
const TYPE_UNKNOWN = 4;
const TYPE_NUMBER_NAN = 5;

// Pen-related constants
const pen = 'runtime.ext_pen';
const penState = `${pen}._getPenState(target)`;

/**
 * Variable pool used for factory function names.
 */
const factoryNameVariablePool = new VariablePool('factory');

/**
 * Variable pool used for generated functions (non-generator)
 */
const functionNameVariablePool = new VariablePool('fun');

/**
 * Variable pool used for generated generator functions.
 */
const generatorNameVariablePool = new VariablePool('gen');

/**
 * @typedef Input
 * @property {() => string} asNumber
 * @property {() => string} asNumberOrNaN
 * @property {() => string} asString
 * @property {() => string} asBoolean
 * @property {() => string} asUnknown
 * @property {() => boolean} isAlwaysNumber
 * @property {() => boolean} isNeverNumber
 */

/**
 * @implements {Input}
 */
class TypedInput {
    constructor (source, type) {
        // for debugging
        if (typeof type !== 'number') throw new Error('type is invalid');
        this.source = source;
        this.type = type;
    }

    asNumber () {
        if (this.type === TYPE_NUMBER) return this.source;
        if (this.type === TYPE_NUMBER_NAN) return `(${this.source} || 0)`;
        return `(+${this.source} || 0)`;
    }

    asNumberOrNaN () {
        if (this.type === TYPE_NUMBER || this.type === TYPE_NUMBER_NAN) return this.source;
        return `(+${this.source})`;
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

    isAlwaysNumber () {
        return this.type === TYPE_NUMBER;
    }

    isNeverNumber () {
        return false;
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

    asNumberOrNaN () {
        return this.asNumber();
    }

    asString () {
        return `"${sanitize('' + this.constantValue)}"`;
    }

    asBoolean () {
        // Compute at compilation time
        return Cast.toBoolean(this.constantValue).toString();
    }

    asUnknown () {
        // Attempt to convert strings to numbers if it is unlikely to break things
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

    isAlwaysNumber () {
        return !Number.isNaN(+this.constantValue);
    }

    isNeverNumber () {
        return Number.isNaN(+this.constantValue);
    }
}

/**
 * SafeConstantInput is similar to ConstantInput, except that asUnknown() will always convert to String.
 */
class SafeConstantInput extends ConstantInput {
    asUnknown () {
        // This input should never be automatically converted to something else.
        return this.asString();
    }

    // Make sure that no blocks will wrongly convert this to number.
    isAlwaysNumber () {
        return false;
    }
}

/**
 * @implements {Input}
 */
class VariableInput {
    constructor (source) {
        this.source = source;
        this.type = TYPE_UNKNOWN;
        /**
         * The value this variable was most recently set to, if any.
         * @type {Input}
         * @private
         */
        this._value = null;
    }

    /**
     * @param {Input} input The input this variable was most recently set to.
     */
    setInput (input) {
        if (input instanceof VariableInput) {
            // When being set to another variable, extract the value it was set to.
            // Otherwise, you may end up with infinite recursion in analysis methods when a variable is set to itself.
            if (input._value) {
                input = input._value;
            } else {
                this.type = TYPE_UNKNOWN;
                return;
            }
        }
        this._value = input;
        if (input instanceof TypedInput) {
            this.type = input.type;
        } else {
            this.type = TYPE_UNKNOWN;
        }
    }

    asNumber () {
        if (this.type === TYPE_NUMBER) return this.source;
        if (this.type === TYPE_NUMBER_NAN) return `(${this.source} || 0)`;
        return `(+${this.source} || 0)`;
    }

    asNumberOrNaN () {
        if (this.type === TYPE_NUMBER || this.type === TYPE_NUMBER_NAN) return this.source;
        return `(+${this.source})`;
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

    isAlwaysNumber () {
        if (this._value) {
            return this._value.isAlwaysNumber();
        }
        return false;
    }

    isNeverNumber () {
        if (this._value) {
            return this._value.isNeverNumber();
        }
        return false;
    }
}

// Running toString() on any of these methods is a mistake.
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

/**
 * Determine if an input is a constant that is a non-zero number.
 * @param {Input} input The input to examine.
 * @returns {boolean} true if the input is a constant non-zero number
 */
const isNonZeroNumberConstant = input => {
    if (!(input instanceof ConstantInput)) {
        return false;
    }
    const value = +input.constantValue;
    return value !== 0;
};

class JSGenerator {
    constructor (script, ast, target) {
        this.script = script;
        this.ast = ast;
        this.target = target;
        this.source = '';

        /**
         * @type {Object.<string, VariableInput>}
         */
        this.variableInputs = {};

        this.isWarp = script.isWarp;
        this.isProcedure = script.isProcedure;
        this.loopStuckChecking = script.loopStuckChecking;

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
            return new TypedInput(`toBoolean(p${node.index})`, TYPE_BOOLEAN);
        case 'args.stringNumber':
            return new TypedInput(`p${node.index}`, TYPE_BOOLEAN);

        case 'compat':
            return new TypedInput(`(${this.generateCompatibilityLayerCall(node)})`, TYPE_UNKNOWN);

        case 'constant':
            return this.safeConstantInput(node.value);

        case 'keyboard.pressed':
            return new TypedInput(`ioQuery("keyboard", "getKeyIsDown", [${this.descendInput(node.key).asUnknown()}])`, TYPE_BOOLEAN);

        case 'list.contains':
            return new TypedInput(`listContains(${this.referenceVariable(node.list)}, ${this.descendInput(node.item).asUnknown()})`, TYPE_BOOLEAN);
        case 'list.contents':
            return new TypedInput(`listContents(${this.referenceVariable(node.list)})`, TYPE_STRING);
        case 'list.get': {
            const index = this.descendInput(node.index);
            if (environment.supportsNullishCoalescing && index.isAlwaysNumber()) {
                return new TypedInput(`(${this.referenceVariable(node.list)}.value[(${index.asNumber()} | 0) - 1] ?? "")`, TYPE_UNKNOWN);
            }
            return new TypedInput(`listGet(${this.referenceVariable(node.list)}.value, ${index.asUnknown()})`, TYPE_UNKNOWN);
        }
        case 'list.indexOf':
            return new TypedInput(`listIndexOf(${this.referenceVariable(node.list)}, ${this.descendInput(node.item).asUnknown()})`, TYPE_NUMBER);
        case 'list.length':
            return new TypedInput(`${this.referenceVariable(node.list)}.value.length`, TYPE_NUMBER);

        case 'looks.size':
            return new TypedInput('Math.round(target.size)', TYPE_NUMBER);
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

        case 'mouse.down':
            return new TypedInput('ioQuery("mouse", "getIsDown")', TYPE_BOOLEAN);
        case 'mouse.x':
            return new TypedInput('ioQuery("mouse", "getScratchX")', TYPE_NUMBER);
        case 'mouse.y':
            return new TypedInput('ioQuery("mouse", "getScratchY")', TYPE_NUMBER);

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
            return new TypedInput(`(${this.descendInput(node.string).asString()}.toLowerCase().indexOf(${this.descendInput(node.contains).asString()}.toLowerCase()) !== -1)`, TYPE_BOOLEAN);
        case 'op.cos':
            return new TypedInput(`(Math.round(Math.cos((Math.PI * ${this.descendInput(node.value).asNumber()}) / 180) * 1e10) / 1e10)`, TYPE_NUMBER);
        case 'op.divide':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} / ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER_NAN);
        case 'op.equals': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            // When both operands are known to never be numbers, only use string comparison to avoid all number parsing.
            if (left.isNeverNumber() || right.isNeverNumber()) {
                return new TypedInput(`(${left.asString()}.toLowerCase() === ${right.asString()}.toLowerCase())`, TYPE_BOOLEAN);
            }
            const leftAlwaysNumber = left.isAlwaysNumber();
            const rightAlwaysNumber = right.isAlwaysNumber();
            // When both operands are known to be numbers, we can use ===
            if (leftAlwaysNumber && rightAlwaysNumber) {
                return new TypedInput(`(${left.asNumber()} === ${right.asNumber()})`, TYPE_BOOLEAN);
            }
            // When one operand is known to be a non-zero constant, we can use ===
            // 0 is not allowed here as NaN will get converted to zero, and "apple or any other NaN value = 0" should not return true.
            // todo: this might be unsafe
            if (leftAlwaysNumber && isNonZeroNumberConstant(left)) {
                return new TypedInput(`(${left.asNumber()} === ${right.asNumber()})`, TYPE_BOOLEAN);
            }
            if (rightAlwaysNumber && isNonZeroNumberConstant(right)) {
                return new TypedInput(`(${left.asNumber()} === ${right.asNumber()})`, TYPE_BOOLEAN);
            }
            // No compile-time optimizations possible - use fallback method.
            return new TypedInput(`compareEqual(${left.asUnknown()}, ${right.asUnknown()})`, TYPE_BOOLEAN);
        }
        case 'op.e^':
            return new TypedInput(`Math.exp(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.floor':
            return new TypedInput(`Math.floor(${this.descendInput(node.value).asNumber()})`, TYPE_NUMBER);
        case 'op.greater': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            // When both operands are known to never be numbers, only use string comparison to avoid all number parsing.
            if (left.isNeverNumber() || right.isNeverNumber()) {
                return new TypedInput(`(${left.asString()}.toLowerCase() > ${right.asString()}.toLowerCase())`, TYPE_BOOLEAN);
            }
            // When both operands are known to be numbers, we can use >
            if (left.isAlwaysNumber() && right.isAlwaysNumber()) {
                return new TypedInput(`(${left.asNumber()} > ${right.asNumber()})`, TYPE_BOOLEAN);
            }
            // No compile-time optimizations possible - use fallback method.
            return new TypedInput(`compareGreaterThan(${left.asUnknown()}, ${right.asUnknown()})`, TYPE_BOOLEAN);
        }
        case 'op.join':
            return new TypedInput(`(${this.descendInput(node.left).asString()} + ${this.descendInput(node.right).asString()})`, TYPE_STRING);
        case 'op.length':
            return new TypedInput(`${this.descendInput(node.string).asString()}.length`, TYPE_NUMBER);
        case 'op.less': {
            const left = this.descendInput(node.left);
            const right = this.descendInput(node.right);
            // When both operands are known to never be numbers, only use string comparison to avoid all number parsing.
            if (left.isNeverNumber() || right.isNeverNumber()) {
                return new TypedInput(`(${left.asString()}.toLowerCase() < ${right.asString()}.toLowerCase())`, TYPE_BOOLEAN);
            }
            // When both operands are known to be numbers, we can use >
            if (left.isAlwaysNumber() && right.isAlwaysNumber()) {
                return new TypedInput(`(${left.asNumber()} < ${right.asNumber()})`, TYPE_BOOLEAN);
            }
            // No compile-time optimizations possible - use fallback method.
            return new TypedInput(`compareLessThan(${left.asUnknown()}, ${right.asUnknown()})`, TYPE_BOOLEAN);
        }
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
        case 'sensing.daysSince2000':
            return new TypedInput('daysSince2000()', TYPE_NUMBER);
        case 'sensing.touching':
            return new TypedInput(`target.isTouchingObject(${this.descendInput(node.object).asUnknown()})`, TYPE_BOOLEAN);
        case 'sensing.touchingColor':
            return new TypedInput(`target.isTouchingColor(colorToList(${this.descendInput(node.color).asUnknown()}))`, TYPE_BOOLEAN);
        case 'sensing.username':
            return new TypedInput('ioQuery("userData", "getUsername")', TYPE_STRING);

        case 'timer.get':
            return new TypedInput('ioQuery("clock", "projectTimer")', TYPE_NUMBER);

        case 'tw.lastKeyPressed':
            return new TypedInput('ioQuery("keyboard", "getLastKeyPressed")', TYPE_STRING);

        case 'var.get':
            return this.descendVariable(node.variable);

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
            this.source += this.generateCompatibilityLayerCall(node);
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
            this.yieldLoop();
            this.source += `}\n`;
            break;
        }
        case 'control.stopAll':
            this.source += 'runtime.stopAll();\n';
            this.retire();
            break;
        case 'control.stopOthers':
            this.source += 'runtime.stopForTarget(target, thread);\n';
            break;
        case 'control.stopScript':
            if (this.isProcedure) {
                this.source += 'return;\n';
            } else {
                this.retire();
            }
            break;
        case 'control.wait': {
            const timer = this.localVariables.next();
            const duration = this.localVariables.next();
            this.source += `var ${timer} = timer();\n`;
            this.source += `var ${duration} = Math.max(0, 1000 * ${this.descendInput(node.seconds).asNumber()});\n`;
            this.requestRedraw();
            // always yield at least once, even on 0 second durations
            this.yieldNotWarp();
            this.source += `while (${timer}.timeElapsed() < ${duration}) {\n`;
            this.yieldNotWarpOrStuck();
            this.source += '}\n';
            break;
        }
        case 'control.waitUntil': {
            this.source += `while (!${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.yieldNotWarpOrStuck();
            this.source += `}\n`;
            break;
        }
        case 'control.while':
            this.source += `while (${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.descendStack(node.do);
            this.yieldLoop();
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
            this.source += `${list}.value.push(${this.descendInput(node.item).asUnknown()});\n`;
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
        case 'list.insert': {
            const list = this.referenceVariable(node.list);
            const index = this.descendInput(node.index);
            const item = this.descendInput(node.item);
            if (index instanceof ConstantInput && +index.constantValue === 1) {
                this.source += `${list}.value.unshift(${item.asUnknown()});\n`;
                this.source += `${list}._monitorUpToDate = false;\n`;
                break;
            }
            this.source += `listInsert(${list}, ${index.asUnknown()}, ${item.asUnknown()});\n`;
            break;
        }
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

        case 'noop':
            // todo: remove noop entirely
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
            const callingFromNonWarpToWarp = !this.isWarp && procedureData.isWarp;
            if (callingFromNonWarpToWarp) {
                this.source += 'thread.warp++;\n';
            } else if (procedureCode === this.script.procedureCode) {
                // Direct recursion yields.
                this.yieldNotWarp();
            }
            if (procedureData.yields) {
                this.source += 'yield* ';
            }
            this.source += `thread.procedures["${sanitize(procedureCode)}"](`;
            // Only include arguments if the procedure accepts any.
            if (procedureData.arguments.length) {
                const args = [];
                for (const input of node.arguments) {
                    args.push(this.descendInput(input).asUnknown());
                }
                this.source += args.join(',');
            }
            this.source += `);\n`;
            if (callingFromNonWarpToWarp) {
                this.source += 'thread.warp--;\n';
            }
            break;
        }

        case 'timer.reset':
            this.source += 'ioQuery("clock", "resetProjectTimer");\n';
            break;

        case 'var.hide':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.variable.id)}", element: "checkbox", value: false }, runtime);\n`;
            break;
        case 'var.set': {
            const variable = this.descendVariable(node.variable);
            const value = this.descendInput(node.value);
            variable.setInput(value);
            this.source += `${variable.source} = ${value.asUnknown()};\n`;
            if (node.variable.isCloud) {
                this.source += `ioQuery("cloud", "requestUpdateVariable", ["${sanitize(node.variable.name)}", ${variable.source}]);\n`;
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
        // Entering a stack -- all bets are off.
        // TODO: allow if/else to inherit values
        this.variableInputs = {};

        for (const node of nodes) {
            this.descendStackedBlock(node);
        }

        // Leaving a stack -- any assumptions made in the current stack do not apply outside of it
        // TODO: in if/else this might create an extra unused object
        this.variableInputs = {};
    }

    descendVariable (variable) {
        if (this.variableInputs.hasOwnProperty(variable.id)) {
            return this.variableInputs[variable.id];
        }
        const input = new VariableInput(`${this.referenceVariable(variable)}.value`);
        this.variableInputs[variable.id] = input;
        return input;
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
        // After running retire() (sets thread status and cleans up some unused data), we need to return to the event loop.
        // When in a procedure, return will only send us back to the previous procedure, so instead we yield back to the sequencer.
        // Outside of a procedure, return will correctly bring us back to the sequencer.
        if (this.isProcedure) {
            this.source += 'retire(); yield;\n';
        } else {
            this.source += 'retire(); return;\n';
        }
    }

    yieldLoop () {
        if (this.loopStuckChecking) {
            this.yieldNotWarpOrStuck();
        } else {
            this.yieldNotWarp();
        }
    }

    /**
     * Write JS to yield the current thread if warp mode is disabled.
     */
    yieldNotWarp () {
        if (!this.isWarp) {
            this.source += 'if (thread.warp === 0) yield;\n';
            this.yielded();
        }
    }

    /**
     * Write JS to yield the current thread if warp mode is disabled or if the script seems to be stuck.
     */
    yieldNotWarpOrStuck () {
        if (this.isWarp) {
            this.source += 'if (isStuck()) yield;\n';
        } else {
            this.source += 'if (thread.warp === 0 || isStuck()) yield;\n';
        }
        this.yielded();
    }

    yielded () {
        // Control may have been yielded to another script -- all bets are off.
        this.variableInputs = {};
    }

    /**
     * Write JS to request a redraw.
     */
    requestRedraw () {
        this.source += 'runtime.requestRedraw();\n';
    }

    safeConstantInput (value) {
        if (typeof value === 'string') {
            if (this.isNameOfCostume(value)) {
                return new SafeConstantInput(value);
            }
        }
        return new ConstantInput(value);
    }

    isNameOfCostume (stringValue) {
        for (const target of this.target.runtime.targets) {
            if (target.isOriginal) {
                if (target.getCostumeIndexByName(stringValue) !== -1) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Generate a call into the compatibility layer.
     * @param {*} node The "compat" kind node to generate from.
     * @returns {string} The JS of the call.
     */
    generateCompatibilityLayerCall (node) {
        const opcode = node.opcode;

        let result = 'yield* executeInCompatibilityLayer({';

        for (const inputName of Object.keys(node.inputs)) {
            const input = node.inputs[inputName];
            const compiledInput = this.descendInput(input).asUnknown();
            result += `"${sanitize(inputName)}":${compiledInput},`;
        }
        for (const fieldName of Object.keys(node.fields)) {
            const field = node.fields[fieldName];
            result += `"${sanitize(fieldName)}":"${sanitize(field)}",`;
        }
        const opcodeFunction = this.evaluateOnce(`runtime.getOpcodeFunction("${sanitize(opcode)}")`);
        result += `}, ${opcodeFunction})`;

        return result;
    }

    /**
     * Generate the JS to pass into eval() based on the current state of the compiler.
     * @returns {string} JS to pass into eval()
     */
    createScriptFactory () {
        let script = '';

        // Setup the factory
        script += `(function ${factoryNameVariablePool.next()}(target) { `;
        script += 'const runtime = target.runtime; ';
        script += 'const stage = runtime.getTargetForStage();\n';
        for (const varValue of Object.keys(this._setupVariables)) {
            const varName = this._setupVariables[varValue];
            script += `const ${varName} = ${varValue};\n`;
        }

        // Generated script
        script += 'return ';
        if (this.script.yields) {
            script += `function* ${generatorNameVariablePool.next()} `;
        } else {
            script += `function ${functionNameVariablePool.next()} `;
        }
        script += '(';
        if (this.script.arguments.length) {
            const args = [];
            for (let i = 0; i < this.script.arguments.length; i++) {
                args.push(`p${i}`);
            }
            script += args.join(',');
        }
        script += ') {\n';

        script += this.source;

        if (!this.isProcedure) {
            script += 'retire();\n';
        }

        script += '}; })';

        return script;
    }

    /**
     * Compile this script.
     * @returns {Function} The factory function for the tree.
     */
    compile () {
        if (this.script.stack) {
            this.descendStack(this.script.stack);
        }

        const factory = this.createScriptFactory();
        const fn = execute.scopedEval(factory);

        log.info(`JS: ${this.target.sprite.name}: compiled ${this.script.procedureCode || 'script'}`, factory);

        return fn;
    }
}

module.exports = JSGenerator;
