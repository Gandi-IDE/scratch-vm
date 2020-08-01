const log = require('../util/log');
const Cast = require('../util/cast');
const VariablePool = require('./variable-pool');
const execute = require('./execute');

const sanitize = string => string.toString()
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
const factoryNameVariablePool = new VariablePool('f_');

/**
 * Variable pool used for generated script names.
 */
const generatorNameVariablePool = new VariablePool('g_');

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
        return `"${sanitize(this.constantValue)}"`;
    }

    asBoolean () {
        // Compute at compilation time
        return Cast.toBoolean(this.constantValue).toString();
    }

    asUnknown () {
        // Attempt to convert strings to numbers, if it is unlikely to break things
        const numberValue = +this.constantValue;
        if (numberValue.toString() === this.constantValue) {
            return this.constantValue;
        }
        return this.asString();
    }
}

class ScriptCompiler {
    constructor (root) {
        this.root = root;
        this.source = '';
        this.localVariables = new VariablePool('a');
        this._setupVariablesPool = new VariablePool('b');
        this._setupVariables = {};
    }

    /**
     * @param {object} node Input node to compile.
     * @returns {Input}
     */
    descendInput (node) {
        switch (node.kind) {
        case 'args.stringNumber':
            return new TypedInput(`C["${sanitize(node.name)}"]`, TYPE_UNKNOWN);

        case 'compat':
            return new TypedInput(`(${this.generateCompatCall(node)})`, TYPE_UNKNOWN);

        case 'constant':
            // todo: converting to number sometimes break things, need to check for those conditions
            return new ConstantInput(node.value);

        case 'list.get':
            return new TypedInput(`listGet(${this.referenceVariable(node.list)}, ${this.descendInput(node.index).asUnknown()})`, TYPE_UNKNOWN);
        case 'list.length':
            return new TypedInput(`${this.referenceVariable(node.list)}.value.length`, TYPE_NUMBER);

        case 'op.add':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} + ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
        case 'op.and':
            return new TypedInput(`(${this.descendInput(node.left).asBoolean()} && ${this.descendInput(node.right).asBoolean()})`, TYPE_BOOLEAN);
        case 'op.divide':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} / ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER_NAN);
        case 'op.equals':
            return new TypedInput(`compareEqual(${this.descendInput(node.left).asUnknown()}, ${this.descendInput(node.right).asUnknown()})`, TYPE_BOOLEAN);
        case 'op.greater':
            return new TypedInput(`compareGreaterThan(${this.descendInput(node.left).asUnknown()}, ${this.descendInput(node.right).asUnknown()})`, TYPE_BOOLEAN);
        case 'op.join':
            return new TypedInput(`(${this.descendInput(node.left).asString()} + ${this.descendInput(node.right).asString()})`, TYPE_STRING);
        case 'op.less':
            return new TypedInput(`compareLessThan(${this.descendInput(node.left).asUnknown()}, ${this.descendInput(node.right).asUnknown()})`, TYPE_BOOLEAN);
        case 'op.letterOf':
            return new TypedInput(`((${this.descendInput(node.string).asString()})[(${this.descendInput(node.letter).asNumber()} | 0) - 1] || "")`, TYPE_STRING);
        case 'op.multiply':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} * ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
        case 'op.or':
            return new TypedInput(`(${this.descendInput(node.left).asBoolean()} || ${this.descendInput(node.right).asBoolean()})`, TYPE_BOOLEAN);
        case 'op.subtract':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} - ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);

        case 'sensing.getTimer':
            return new TypedInput('ioQuery("clock", "projectTimer")', TYPE_NUMBER);

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

        case 'control.if':
            this.source += `if (${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.descendStack(node.whenTrue);
            this.source += `} else {\n`;
            // todo: no else branch if empty?
            this.descendStack(node.whenFalse);
            this.source += `}\n`;
            break;
        case 'control.repeat': {
            const i = this.localVariables.next();
            this.source += `for (var ${i} = ${this.descendInput(node.times).asNumber()}; ${i} >= 0.5; ${i}--) {\n`;
            this.descendStack(node.do);
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
                this.source += 'return;\n';
                if (this.root.isProcedure) {
                    if (this.root.isWarp) {
                        this.source += 'thread.warp--;\n';
                    }
                    this.source += 'return;\n';
                } else {
                    this.retire();
                }
            }
            break;
        }
        case 'control.while':
            this.source += `while (${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.descendStack(node.do);
            this.yieldNotWarp();
            this.source += `}\n`;
            break;

        case 'list.add':
            this.source += `${this.referenceVariable(node.list)}.value.push(${this.descendInput(node.item).asUnknown()});\n`;
            // todo _monitorUpToDate
            break;
        case 'list.deleteAll':
            this.source += `${this.referenceVariable(node.list)}.value = [];\n`;
            // todo _monitorUpToDate
            break;
        case 'list.hide':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.list.id)}", element: "checkbox", value: false }, runtime);\n`;
            break;
        case 'list.replace':
            this.source += `listReplace(${this.referenceVariable(node.list)}, ${this.descendInput(node.index).asUnknown()}, ${this.descendInput(node.item).asUnknown()});\n`;
            break;
        case 'list.show':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.list.id)}", element: "checkbox", value: true }, runtime);\n`;
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
        case 'looks.show':
            this.source += 'target.setVisible(true);\n';
            this.source += 'runtime.ext_scratch3_looks._renderBubble(target);\n';
            break;
        case 'looks.switchCostume':
            this.source += `runtime.ext_scratch3_looks._setCostume(target, ${this.descendInput(node.costume).asUnknown()});\n`;
            break;

        case 'motion.step':
            this.source += `runtime.ext_scratch3_motion._moveSteps(${this.descendInput(node.steps).asNumber()}, target);\n`;
            break;

        case 'pen.clear':
            this.source += `${pen}.clear();\n`;
            break;

        case 'procedures.call':
            this.source += `yield* thread.procedures["${sanitize(node.code)}"]({`;
            for (const name of Object.keys(node.parameters)) {
                this.source += `"${sanitize(name)}":${this.descendInput(node.parameters[name]).asUnknown()},`;
            }
            this.source += `});\n`;
            break;

        case 'sensing.resetTimer':
            this.source += 'ioQuery("clock", "resetProjectTimer");\n';
            break;

        case 'var.change': {
            const variable = this.referenceVariable(node.variable);
            // todo: cloud
            this.source += `${variable}.value = (+${variable}.value || 0) + ${this.descendInput(node.value).asUnknown()};\n`;
            break;
        }

        case 'var.hide':
            this.source += `runtime.monitorBlocks.changeBlock({ id: "${sanitize(node.variable.id)}", element: "checkbox", value: false }, runtime);\n`;
            break;
        case 'var.set':
            // todo: cloud
            this.source += `${this.referenceVariable(node.variable)}.value = ${this.descendInput(node.value).asUnknown()};\n`;
            break;
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
        // todo: factoryVariables
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
        this.source += 'retire(); yield;';
    }

    yieldNotWarp () {
        if (!this.root.isWarp) {
            this.source += 'if (!thread.warp) yield;\n';
        }
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
            result += `"${sanitize(fieldName)}":${sanitize(field.value)},`;
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
        if (this.root.isProcedure) {
            // procedures accept single argument "C"
            script += 'C';
        }
        script += ') {\n';

        if (this.root.isWarp) {
            script += 'thread.warp++;\n';
        }

        script += this.source;

        if (!this.root.isProcedure) {
            script += 'retire();\n';
        } else if (this.root.isWarp) {
            script += 'thread.warp--;\n';
        }

        script += '}; })';

        return script;
    }

    compile () {
        this.descendStack(this.root.stack);

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
    constructor (ast) {
        this.ast = ast;
        this.compilingProcedures = [];
        this.compiledProcedures = {};
    }

    compileTree (root) {
        for (const procedureCode of root.dependedProcedures) {
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

        const compiler = new ScriptCompiler(root);
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
