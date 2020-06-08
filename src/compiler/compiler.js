const log = require('../util/log');
const Thread = require('../engine/thread');

const statements = {};
const inputs = {};

const defaultExtensions = [
    require('./blocks/compiler_natives'),
    require('./blocks/compiler_scratch3_control'),
    require('./blocks/compiler_scratch3_looks'),
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

class BLockUtil {
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

class InputUtil extends BLockUtil {
    constructor(compiler, block) {
        super(compiler, block);
    }
}

class StatementUtil extends BLockUtil {
    constructor(compiler, block) {
        super(compiler, block);
        this.source = '';
    }

    yieldLoop() {
        this.writeLn('yield;');
    }

    writeLn(s) {
        this.source += s + '\n';
    }

    write(s) {
        this.source += s;
    }

    compileSubstack(inputName) {
        const inputValue = this.block.inputs[inputName];
        const substack = inputValue.block;
        return this.compiler.compileStack(substack);
    }
}

class Compiler {
    /**
    *
    * @param {Thread} thread
    */
    constructor(thread) {
        this.thread = thread;
    }

    compileInput(parentBlock, inputName) {
        const input = parentBlock.inputs[inputName];
        const inputId = input.block;
        const block = this.thread.target.blocks.getBlock(inputId);

        const util = new InputUtil(this, block);
        let compiler = inputs[block.opcode];
        if (!compiler) {
            throw new Error('unknown opcode: ' + block.opcode);
        }

        const result = compiler(util);

        return result;
    }

    compileStack(startingId) {
        let blockId = startingId;
        let source = '';

        while (blockId !== null) {
            const block = this.thread.target.blocks.getBlock(blockId);
            if (!block) {
                throw new Error('no block');
            }

            const util = new StatementUtil(this, block);
            let compiler = statements[block.opcode];
            if (!compiler) {
                throw new Error('unknown opcode: ' + block.opcode);
            }

            compiler(util);
            source += util.source;
            blockId = block.next;
        }
        return source;
    }

    compile() {
        const target = this.thread.target;
        if (!target) throw new Error('no target');

        const topBlockId = this.thread.topBlock;
        const topBlock = this.thread.target.blocks.getBlock(topBlockId);

        const script = this.compileStack(topBlock.next);

        log.info('compiled script', script);

        // TODO: move this to execute.js
        var fn = eval('(function* compiled_script() { ' + script + ' })');
        return fn;
    }
}

module.exports = Compiler;
