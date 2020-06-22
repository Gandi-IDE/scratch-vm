const log = require('../util/log');
const Thread = require('../engine/thread');
const Target = require('../engine/target');
const Runtime = require('../engine/runtime');
const execute = require('./execute');

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
     * Get the field data object.
     * @param {string} name The name of the field. (VARIABLE, TEXT, etc.)
     */
    field(name) {
        return this.block.fields[name];
    }

    /**
     * Get the raw text value of a field.
     * This value is *not* safe to include directly in scripts.
     * @param {string} name The name of the field. (VARIABLE, TEXT, etc.)
     * @returns {string}
     */
    fieldValueUnsafe(name) {
        return this.field(name).value;
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
            .replace(/\r/g, '\\r')
            .replace(/\{/g, '\\x7b')
            .replace(/\}/g, '\\x7d');
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

    fieldString(name) {
        return new CompiledInput(`"${this.safe(this.fieldValueUnsafe(name))}"`, TYPE_STRING);
    }

    noop() {
        return new CompiledInput('/* no-op */ undefined', TYPE_UNKNOWN);
    }
}

class StatementUtil extends BlockUtil {
    constructor(compiler, block) {
        super(compiler, block);
        this.source = '';
    }

    nextLabel() {
        return this.compiler.nextLabel();
    }

    /**
     * @param {number} [label]
     */
    putLabel(label) {
        if (label === undefined) {
            label = this.nextLabel();
        }
        this.write(`{{${label}}}`);
        return label;
    }

    /**
     * Immediately jump to a label.
     * @param {number} label 
     */
    jump(label) {
        this.writeLn(`jump(${label}); return;`);
    }
    
    /**
     * Lazily jump to a label.
     * If running in warp mode, this will be instant. Otherwise, it will run the next tick.
     * @param {number} label 
     */
    jumpLazy(label) {
        this.writeLn(`jumpLazy(${label}); return;`);
    }

    writeLn(s) {
        this.source += s + '\n';
    }

    write(s) {
        this.source += s;
    }

    enterState(state) {
        this.writeLn(`enterState(${state});`);
    }

    restoreState() {
        this.writeLn('restoreState();');
    }

    nextLocalVariable() {
        this.compiler.variableCount++;
        return 'var' + this.compiler.variableCount;
    }

    noop() {
        this.writeLn('/* no-op */');
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
        return 'toNumber(' + this.source + ')';
    }

    asBoolean() {
        if (this.type === TYPE_BOOLEAN) return this.source;
        return 'toBoolean(' + this.source + ')';
    }

    asString() {
        if (this.type === TYPE_STRING) return this.source;
        return 'toString(' + this.source + ')';
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
        this.variableCount = 0;
        this.labelCount = 0;
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

    nextLabel() {
        return this.labelCount++;
    }

    parseContinuations(script) {
        const labels = {};
        let index = 0;
        let accumulator = 0;

        while (true) {
            const labelStart = script.indexOf('{{', index);
            if (labelStart === -1) {
                break;
            }
            const labelEnd = script.indexOf('}}', index);
            const id = script.substring(labelStart + 2, labelEnd);
            const length = labelEnd + 2 - labelStart;
            accumulator += length;

            labels[id] = labelEnd + 2 - accumulator;

            index = labelEnd + 2;
        }

        const modifiedScript = script.replace(/{{\d+}}/g, '');

        return {
            labels,
            script: modifiedScript,
        };
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

        let script = '';
        // must always place a label at the start, this will be the first label to run
        script += '{{' + this.nextLabel() + '}}';
        script += this.compileStack(startingBlock);
        // kill thread at the end of script
        script += 'target.runtime.sequencer.retireThread(thread);';

        const parseResult = this.parseContinuations(script);
        const parsedScript = parseResult.script;

        const totalLabels = this.thread.functionJumps.length;
        for (const label of Object.keys(parseResult.labels)) {
          this.thread.functionJumps[label] = execute.createContinuation(this, parsedScript.slice(parseResult.labels[label]));
        }
  
        log.info(`[${this.target.getName()}] compiled sb3 script`, script);

        this.thread.fn = this.thread.functionJumps[totalLabels];
    }
}

Compiler.BlockUtil = BlockUtil;
Compiler.InputUtil = InputUtil;
Compiler.StatementUtil = StatementUtil;
Compiler.CompiledInput = CompiledInput;

module.exports = Compiler;
