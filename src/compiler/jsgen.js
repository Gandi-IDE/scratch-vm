const log = require('../util/log');
const Cast = require('../util/cast');
const VariablePool = require('./variable-pool');
const execute = require('./execute');

const sanitize = (string) => string
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

const disableToString = (obj) => {
    obj.toString = () => {
        throw new Error(`toString unexpectedly called on ${obj.name || 'object'}`);
    };
};

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
    constructor(source, type) {
        // for debugging
        if (typeof type !== 'number') throw new Error('type is invalid');
        /** @private */
        this.source = source;
        /** @private */
        this.type = type;
    }

    asNumber () {
        if (this.type === TYPE_NUMBER) return this.source;
        if (this.type === TYPE_NUMBER_NAN) return '(' + this.source + ' || 0)';
        return '(+' + this.source + ' || 0)';
    }

    asString () {
        if (this.type === TYPE_STRING) return this.source;
        return '("" + ' + this.source + ')';
    }

    asBoolean () {
        if (this.type === TYPE_BOOLEAN) return this.source;
        return 'toBoolean(' + this.source + ')';
    }

    asUnknown () {
        return this.source;
    }
}

/**
 * @implements {Input}
 */
class ConstantInput {
    constructor(constantValue) {
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
        return '"' + sanitize(this.constantValue) + '"';
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
     * @param {Object} node Input node to compile.
     * @returns {Input}
     */
    descendInput (node) {
        switch (node.kind) {
        case 'constant':
            // todo: converting to number sometimes break things, need to check for those conditions
            return new ConstantInput(node.value);

        case 'args.stringNumber':
            return new TypedInput(`C["${sanitize(node.name)}"]`, TYPE_UNKNOWN);

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
        case 'op.multiply':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} * ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
        case 'op.or':
            return new TypedInput(`(${this.descendInput(node.left).asBoolean()} || ${this.descendInput(node.right).asBoolean()})`, TYPE_BOOLEAN);
        case 'op.subtract':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} - ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
    
        case 'timer.get':
            return new TypedInput('ioQuery("clock", "projectTimer")', TYPE_NUMBER);
            
        case 'var.get':
            return new TypedInput(`${this.referenceVariable(node.variable)}.value`, TYPE_UNKNOWN);

        default:
            log.warn('JS: Unknown input: ' + node.kind, node);
            throw new Error('JS: Unknown input: ' + node.kind);
        }
    }

    /**
     * @param {*} node Stacked node to compile.
     */
    descendStackedBlock (node) {
        switch (node.kind) {
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
        case 'list.replace':
            this.source += `listReplace(${this.referenceVariable(node.list)}, ${this.descendInput(node.index).asUnknown()}, ${this.descendInput(node.item).asUnknown()});\n`;
            break;
    
        case 'motion.step':
            this.source += `runtime.ext_scratch3_motion._moveSteps(${this.descendInput(node.steps).asNumber()}, target);\n`;
            break;

        case 'procedures.call':
            this.source += `yield* thread.procedures["${sanitize(node.code)}"]({`;
            for (const name of Object.keys(node.parameters)) {
                this.source += `"${sanitize(name)}":${this.descendInput(node.parameters[name]).asUnknown()},`;
            }
            this.source += `});\n`;
            break;

        case 'timer.reset':
            this.source += 'ioQuery("clock", "resetProjectTimer");\n';
            break;

        case 'var.change': {
            const variable = this.referenceVariable(node.variable);
            // todo: cloud
            this.source += `${variable}.value = (+${variable}.value || 0) + ${this.descendInput(node.value).asUnknown()};\n`;
            break;
        }    
        case 'var.set':
            // todo: cloud
            this.source += `${this.referenceVariable(node.variable)}.value = ${this.descendInput(node.value).asUnknown()};\n`;
            break;
    
        default:
            log.warn('JS: Unknown stacked block: ' + node.kind, node);
            throw new Error('JS: Unknown stacked block: ' + node.kind);
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
        } else {
            return this.evaluateOnce(`stage.variables["${sanitize(variable.id)}"]`);
        }
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
    }

    compile () {
        const entry = new ScriptCompiler(this.ast.entry).compile();

        const procedures = {};
        for (const procedureCode of Object.keys(this.ast.procedures)) {
            const compiled = new ScriptCompiler(this.ast.procedures[procedureCode]).compile();
            procedures[procedureCode] = compiled;
        }

        return {
            startingFunction: entry,
            procedures: procedures,
        };
    }
}

module.exports = JSCompiler;
