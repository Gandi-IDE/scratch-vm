const log = require('../util/log');
const Cast = require('../util/cast');

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
        /** @private */
        this.source = source;
        /** @private */
        this.type = type;
    }

    asNumber () {
        if (this.type === TYPE_NUMBER) {
            // TODO: NaN
            return this.source;
        }
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
        return this.asString();
    }
}

class ScriptCompiler {
    constructor (root) {
        this.root = root;
        this.source = '';
    }

    /**
     * @param {Object} node Input node to compile.
     * @returns {Input}
     */
    descendInput (node) {
        switch (node.kind) {
        case 'constant':
            return new ConstantInput(node.value);

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
            this.source += `if (${this.descendInput(node.condition)}) {\n`;
            this.descendStack(node.whenTrue);
            this.source += `} else {\n`;
            // todo: no else branch if empty?
            this.descendStack(node.whenFalse);
            this.source += `}\n`;
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

    compile () {
        this.descendStack(this.root.stack);
        return this.source;
    }
}

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
