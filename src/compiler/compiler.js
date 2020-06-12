const log = require('../util/log');
const Thread = require('../engine/thread');
const Target = require('../engine/target');
const Runtime = require('../engine/runtime');
const _eval = require('./eval');

const statements = {};
const inputs = {};

const defaultExtensions = [
    require('./blocks/compiler_natives'),
    require('./blocks/compiler_scratch3_motion'),
    require('./blocks/compiler_scratch3_looks'),
    require('./blocks/compiler_scratch3_sounds'),
    require('./blocks/compiler_scratch3_events'),
    require('./blocks/compiler_scratch3_control'),
    require('./blocks/compiler_scratch3_sensing'),
    require('./blocks/compiler_scratch3_operators'),
    require('./blocks/compiler_scratch3_data'),
    require('./blocks/compiler_scratch3_procedures'),
    // TODO: do not load extensions immediately
    require('./extensions/compiler_pen'),
];

const TYPE_UNKNOWN = 0;
const TYPE_NUMBER = 1;
const TYPE_BOOLEAN = 2;
const TYPE_STRING = 3;

defaultExtensions.forEach((ext) => {
    const extensionInputs = ext.getInputs();
    for (const op in extensionInputs) {
        if (extensionInputs.hasOwnProperty(op)) {
            inputs[op] = extensionInputs[op];
        }
    }

    const extensionStatements = ext.getStatements();
    for (const op in extensionStatements) {
        if (extensionStatements.hasOwnProperty(op)) {
            statements[op] = extensionStatements[op];
        }
    }
});

class BlockUtil {
    /**
     * @param {Compiler} compiler 
     */
    constructor(compiler, block) {
        this.compiler = compiler;
        this.block = block;
    }

    get target() {
        return this.compiler.target;
    }

    /**
     * Whether the target being compiled is a stage.
     * @type {boolean}
     */
    get isStage() {
        return !!this.target.isStage;
    }

    /**
     * Compile an input of this block.
     * @param {string} name The name of the input. (CONDITION, VALUE, etc.)
     * @returns {CompiledInput}
     */
    input(name) {
        return this.compiler.compileInput(this.block, name);
    }

    /**
     * Get the raw text value of a field.
     * This value is *not* safe to include directly in scripts.
     * @param {string} name The name of the field. (VARIABLE, TEXT, etc.)
     * @returns {string}
     */
    fieldUnsafe(name) {
        return this.block.fields[name].value;
    }

    /**
     * Make text safe to include inside a JavaScript string.
     * safe() does not put quotes around the string, you must do that yourself.
     * @param {string} string The text to make safe
     * @returns {string}
     */
    safe(string) {
        return string
            .replace(/\\/g, '\\\\')
            .replace(/'/g, '\\\'')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    }
}

class InputUtil extends BlockUtil {
    unknown(source) {
        return new CompiledInput(source, TYPE_UNKNOWN);
    }

    number(source) {
        return new CompiledInput(source, TYPE_NUMBER);
    }

    boolean(source) {
        return new CompiledInput(source, TYPE_BOOLEAN);
    }

    string(source) {
        return new CompiledInput(source, TYPE_STRING);
    }
}

class StatementUtil extends BlockUtil {
    constructor(compiler, block) {
        super(compiler, block);
        this.source = '';
    }

    yieldLoop() {
        // TODO: do not yield in warp context
        this.writeLn(`yield;`);
    }

    writeLn(s) {
        this.source += s + '\n';
    }

    write(s) {
        this.source += s;
    }

    nextVariable() {
        this.compiler.variables++;
        return 'var' + this.compiler.variables;
    }

    substack(inputName) {
        const inputValue = this.block.inputs[inputName];
        if (!inputValue) {
            // empty substack
            return '';
        }
        const substack = inputValue.block;
        return this.compiler.compileStack(substack);
    }
}

class CompiledInput {
    /**
     * @param {string} source The input's source code.
     * @param {number} type The input's type at runtime.
     */
    constructor(source, type) {
        this.source = source;
        this.type = type;
    }

    toString() {
        return this.source;
    }

    asNumber() {
        if (this.type === TYPE_NUMBER) return this.source;
        return '(+' + this.source + ')';
    }

    asBoolean() {
        if (this.type === TYPE_BOOLEAN) return this.source;
        return '!!(' + this.source + ')';
    }

    asString() {
        if (this.type === TYPE_STRING) return this.source;
        // TODO: toString() instead
        return '(""+' + this.source + ')';
    }
}

class Compiler {
    /**
     * @param {Thread} thread 
     */
    constructor(thread) {
        this.thread = thread;
        /** @type {Target} */
        this.target = thread.target;
        /** @type {Runtime} */
        this.runtime = this.target.runtime;
        this.variables = 0;
    }

    /**
     * @returns {CompiledInput}
     */
    compileInput(parentBlock, inputName) {
        const input = parentBlock.inputs[inputName];
        const inputId = input.block;
        const block = this.thread.target.blocks.getBlock(inputId);

        let compiler = inputs[block.opcode];
        if (!compiler) {
            log.error('unknown opcode', block);
            throw new Error('unknown opcode: ' + block.opcode);
        }

        const util = new InputUtil(this, block);
        const result = compiler(util);

        return result;
    }

    /**
     * @param {string} startingId The ID of the first block in the stack.
     * @returns {string}
     */
    compileStack(startingId) {
        let blockId = startingId;
        let source = '';

        while (blockId !== null) {
            const block = this.thread.target.blocks.getBlock(blockId);
            if (!block) {
                throw new Error('no block');
            }

            let compiler = statements[block.opcode];
            if (!compiler) {
                log.error('unknown opcode', block);
                throw new Error('unknown opcode: ' + block.opcode);
            }

            const util = new StatementUtil(this, block);
            compiler(util);
            source += util.source;
            blockId = block.next;
        }

        return source;
    }

    compile() {
        const target = this.target;
        if (!target) throw new Error('no target');

        const topBlockId = this.thread.topBlock;
        const topBlock = this.target.blocks.getBlock(topBlockId);
        // TODO: figure out how to run blocks from the flyout, they have their ID set to their opcode
        if (!topBlock) throw new Error('top block is missing');

        let startingBlock;
        // if the top block is a hat, jump to the next block
        if (this.runtime.getIsHat(topBlock.opcode)) {
            startingBlock = topBlock.next;
        } else {
            startingBlock = topBlockId;
        }

        const script = this.compileStack(startingBlock);
        if (script.length === 0) throw new Error('generated script was empty');

        try {
            const fn = _eval(this, `(function* compiled_script() {\n${script}\nthread.status = 4;\n})`);
            if (typeof fn !== 'function') throw new Error('fn is not a function');
            log.info(this.target.getName(), 'compiled script', script);
            return fn;
        } catch (e) {
            log.error(this.target.getName(), 'error evaling', e, script);
            throw e;
        }
    }
}

Compiler.BlockUtil = BlockUtil;
Compiler.InputUtil = InputUtil;
Compiler.StatementUtil = StatementUtil;
Compiler.CompiledInput = CompiledInput;

module.exports = Compiler;
