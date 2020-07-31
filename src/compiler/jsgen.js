const log = require('../util/log');
const Cast = require('../util/cast');
const VariablePool = require('./variable-pool');

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
        const numberValue = +this.constantValue;
        return numberValue.toString();
    }

    asString () {
        return '"' + sanitize(this.constantValue) + '"';
    }

    asBoolean () {
        return Cast.toBoolean(this.constantValue).toString();
    }

    asUnknown () {
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

        case 'var.get':
            return new TypedInput(`${this.referenceVariable(node.variable)}.value`, TYPE_UNKNOWN);

        case 'list.get':
            return new TypedInput(`listGet(${this.referenceVariable(node.list)}, ${this.descendInput(node.index).asUnknown()})`, TYPE_UNKNOWN);
        case 'list.length':
            return new TypedInput(`${this.referenceVariable(node.list)}.value.length`, TYPE_NUMBER);

        case 'args.stringNumber':
            return new TypedInput(`C["${sanitize(node.name)}"]`, TYPE_UNKNOWN);

        case 'op.subtract':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} + ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
        case 'op.add':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} - ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
        case 'op.multiply':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} * ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER);
        case 'op.divide':
            return new TypedInput(`(${this.descendInput(node.left).asNumber()} / ${this.descendInput(node.right).asNumber()})`, TYPE_NUMBER_NAN);
        case 'op.equals':
            return new TypedInput(`compareEqual(${this.descendInput(node.left).asUnknown()}, ${this.descendInput(node.right).asUnknown()})`, TYPE_BOOLEAN);
        case 'op.less':
            return new TypedInput(`compareLessThan(${this.descendInput(node.left).asUnknown()}, ${this.descendInput(node.right).asUnknown()})`, TYPE_BOOLEAN);
        case 'op.greater':
            return new TypedInput(`compareGreaterThan(${this.descendInput(node.left).asUnknown()}, ${this.descendInput(node.right).asUnknown()})`, TYPE_BOOLEAN);

        default:
            // todo: error, not warn
            log.warn('JS: unknown input: ' + node.kind, node);
            return new ConstantInput('0');
        }
    }

    /**
     * @param {*} node Stacked node to compile.
     */
    descendStackedBlock (node) {
        switch (node.kind) {
        case 'control.while':
            this.source += `while (${this.descendInput(node.condition).asBoolean()}) {\n`;
            this.descendStack(node.do);
            this.source += `}\n`;
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
                // if (this.isProcedure) {
                //     if (this.isWarp) {
                //         util.writeLn('thread.warp--;');
                //     }
                //     util.writeLn('return;');
                // } else {
                //     util.retire();
                // }
            }
            break;
        }

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
        
        case 'var.set':
            // todo: cloud
            this.source += `${this.referenceVariable(node.variable)}.value = ${this.descendInput(node.value).asUnknown()};\n`;
            break;
        case 'var.change': {
            const variable = this.referenceVariable(node.variable);
            // todo: cloud
            this.source += `${variable}.value = (+${variable} || 0) + ${this.descendInput(node.value).asUnknown()};\n`;
            break;
        }

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

        default:
            // todo: error, not warn
            log.warn('JS: unknown stacked block: ' + node.kind, node);
            this.source += '/* no-op (missing) */\n';
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
            return `target.variables["${sanitize(variable.id)}"]`;
        } else {
            return `stage.variables["${sanitize(variable.id)}"]`;
        }
    }


    retire () {
        this.source += 'retire(); yield;';
    }

    compile () {
        this.descendStack(this.root.stack);
        return this.source;
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
        console.log('entry', entry);

        for (const procedureCode of Object.keys(this.ast.procedures)) {
            const source = new ScriptCompiler(this.ast.procedures[procedureCode]).compile();
            console.log(procedureCode, source);
        }
    }
}

module.exports = JSCompiler;
