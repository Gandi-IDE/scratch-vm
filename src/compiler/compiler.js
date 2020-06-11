const log = require('../util/log');
const Thread = require('../engine/thread');
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
];

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

    getInput(name) {
        return this.compiler.compileInput(this.block, name);
    }

    getFieldUnsafe(name) {
        return this.block.fields[name].value;
    }
}

class InputUtil extends BlockUtil {
    number(source) {
        return new CompiledInput(source);
    }
}

class StatementUtil extends BlockUtil {
    constructor(compiler, block) {
        super(compiler, block);
        this.source = '';
    }

    yieldLoop() {
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

    compileSubstack(inputName) {
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
     */
    constructor(source) {
        this.source = source;
    }

    toString() {
        return this.source;
    }
}

class Compiler {
    /**
     * @param {Thread} thread 
     */
    constructor(thread) {
        this.thread = thread;
        this.target = thread.target;
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
        if (!topBlock) throw new Error('not a hat');

        const script = this.compileStack(topBlock.next);
        if (script.length === 0) {
            throw new Error('generated script was empty');
        }

        log.info('compiled script', script);

        try {
            const fn = _eval(this, `(function* compiled_script() {\n${script}\nthread.status = 4;\n})`);
            if (typeof fn !== 'function') {
                throw new Error('fn is not a function');
            }
            return fn;
        } catch (e) {
            log.error('error evaling', e, script);
            throw e;
        }
    }
}

Compiler.InputUtil = InputUtil;
Compiler.StatementUtil = StatementUtil;
Compiler.CompiledInput = CompiledInput;

module.exports = Compiler;
