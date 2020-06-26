const log = require('../util/log');
const Thread = require('../engine/thread');
const Target = require('../engine/target');
const Runtime = require('../engine/runtime');
const execute = require('./execute');
const Blocks = require('../engine/blocks');

const statements = {};
const inputs = {};

const defaultExtensions = [
    require('./blocks/compiler_natives'),
    require('./blocks/compiler_scratch3_motion'),
    require('./blocks/compiler_scratch3_looks'),
    require('./blocks/compiler_scratch3_sounds'),
    require('./blocks/compiler_scratch3_event'),
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

const FLAG_NULLABLE = 1;
const FLAG_NANABLE = 2;

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

/**
 * Prevents the use of toString() on an object by throwing an error.
 * Useful to make sure that a method is always called, never stringified.
 * @param {Object} obj 
 */
const disableToString = (obj) => {
    obj.toString = () => {
        throw new Error(`toString unexpectedly called on ${obj.name || 'object'}, did you forget to call it?`);
    };
};

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
        if (!this.hasInput(name)) {
            return new CompiledInput('""', TYPE_STRING);
        }
        return this.compiler.compileInput(this.block, name);
    }

    /**
     * Return whether this block has an input of a given name.
     * @param {string} name The name of the input. (CONDITION, VALUE, etc.)
     */
    hasInput(name) {
        return this.block.inputs.hasOwnProperty(name) && this.block.inputs[name].block !== null;
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

    /**
     * @returns {number}
     */
    nextLabel() {
        return this.compiler.nextLabel();
    }

    /**
     * @param {number} [label]
     * @returns {number}
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

    /**
     * Writes the necessary JS to yield the current thread until all given threads have finished executing.
     * @param {string} threads The threads to wait for (eg. "thread.state")
     */
    waitUntilThreadsComplete(threads) {
        this.enterState(threads);
        const label = this.putLabel();
        this.writeLn(`if (waitThreads(thread.state)) {`);
        this.jumpLazy(label);
        this.writeLn(`}`);
    }

    /**
     * Write JS to this statement, followed by a newline.
     * @param {string} s The source to write.
     */
    writeLn(s) {
        this.source += s + '\n';
    }

    /**
     * Write JS to this statement.
     * @param {string} s The source to write.
     */
    write(s) {
        this.source += s;
    }

    /**
     * Replace thread.state with a new state. The old state is saved so it can be restored later.
     * @param {string} state JS to become new state.
     */
    enterState(state) {
        this.writeLn(`thread.enterState(${state});`);
    }

    /**
     * Replace thread.state with the previous state.
     */
    restoreState() {
        this.writeLn('thread.restoreState();');
    }

    noop() {
        this.writeLn('/* no-op */');
    }

    /**
     * Compile a substack.
     * @param {string} inputName The name of the substack.
     * @returns {string}
     */
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
        /**
         * The input's source code.
         * @readonly
         * @private
         */
        this.source = source;
        /**
         * The input's type.
         * @readonly
         * @private
         */
        this.type = type;
        /**
         * Internal flags.
         * @private
         */
        this.flags = 0;
    }

    /**
     * Enable the NULLABLE flag.
     */
    nullable() {
        this.flags |= FLAG_NULLABLE;
        return this;
    }

    /**
     * Enable the NANABLE flag.
     */
    nanable() {
        this.flags |= FLAG_NANABLE;
        return this;
    }

    toString() {
        return this.source;
    }

    asNumber() {
        if (this.type === TYPE_NUMBER) {
            if (this.flags & FLAG_NANABLE) {
                return 'toNotNaN(' + this.source + ')';
            }
            return this.source;
        }
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

disableToString(CompiledInput.prototype.asNumber);
disableToString(CompiledInput.prototype.asString);
disableToString(CompiledInput.prototype.asBoolean);

/**
 * @typedef {Function} Jump
 */

/**
 * @typedef {Object} CompiledProcedure
 * @property {boolean} warp
 * @property {number} label
 */

/**
 * @typedef {Object} CompilationResult
 * @property {Function} startingFunction
 * @property {Jump[]} jumps
 * @property {Object.<string, CompiledProcedure>} procedures
 */

class Compiler {
    /**
     * @param {Thread} thread
     */
    constructor(thread) {
        /** @type {Target} */
        this.target = thread.target;
        if (!this.target) {
            throw new Error('Missing target');
        }

        /** @type {Runtime} */
        this.runtime = this.target.runtime;

        /** @type {Blocks} */
        this.blocks = this.target.blocks;

        /** @type {string} */
        this.topBlock = thread.topBlock;

        /** @type {number} */
        this.labelCount = 0;

        /**
         * Function jump points.
         * @type {Jump[]}
         */
        this.jumps = [];

        /**
         * Compiled procedures.
         * @type {Object.<string, CompiledProcedure>}
         */
        this.procedures = {};

        /**
         * Procedures that are queued to be compiled.
         * Map of procedure code to the ID of the definition block.
         * @type {Map.<string, string>}
         * @private
         */
        this.uncompiledProcedures = new Map();

        /**
         * Procedures that are being compiled.
         * Same structure as uncompiledProcedures.
         * @type {Map.<string, string>}
         * @private
         */
        this.compilingProcedures = new Map();
    }

    /**
     * Ask the compiler to queue the compilation of a procedure.
     * This will do nothing if the procedure is already compiled or queued.
     * @param {string} procedureCode The procedure's code
     */
    dependProcedure(procedureCode) {
        if (this.procedures.hasOwnProperty(procedureCode)) {
            // already compiled
            return;
        }
        if (this.compilingProcedures.has(procedureCode)) {
            // being compiled
            return;
        }
        if (this.uncompiledProcedures.has(procedureCode)) {
            // queued to be compiled
            return;
        }
        const definition = this.target.blocks.getProcedureDefinition(procedureCode);
        this.uncompiledProcedures.set(procedureCode, definition);
    }

    /**
     * @returns {CompiledInput}
     */
    compileInput(parentBlock, inputName) {
        const input = parentBlock.inputs[inputName];
        const inputId = input.block;
        const block = this.blocks.getBlock(inputId);

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
            const block = this.blocks.getBlock(blockId);
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

    compileHat(topBlock) {
        let script = '';
        script += '{{' + this.nextLabel() + '}}';
        script += this.compileStack(topBlock);
        script += 'end();';

        const parseResult = this.parseContinuations(script);
        const parsedScript = parseResult.script;

        const startingLabelCount = this.jumps.length;
        for (const label of Object.keys(parseResult.labels)) {
          this.jumps[label] = execute.createContinuation(this, parsedScript.slice(parseResult.labels[label]));
        }

        log.info(`[${this.target.getName()}] compiled script`, script);
        return startingLabelCount;
    }

    /**
     * @returns {CompilationResult}
     */
    compile() {
        const target = this.target;
        if (!target) throw new Error('no target');

        const topBlock = this.target.blocks.getBlock(this.topBlock);
        // TODO: figure out how to run blocks from the flyout, they have their ID set to their opcode
        if (!topBlock) throw new Error('top block is missing');

        // Compile the initial script to be started.
        // We skip hat blocks, as they do not have code that can be run.
        let startingBlock;
        if (this.runtime.getIsHat(topBlock.opcode)) {
            startingBlock = topBlock.next;
        } else {
            startingBlock = this.topBlock;
        }
        const startingFunction = this.compileHat(startingBlock);

        // Compile any required procedures.
        // As procedures can depend on other procedures, this process may take several iterations.
        while (this.uncompiledProcedures.size > 0) {
            this.compilingProcedures = this.uncompiledProcedures;
            this.uncompiledProcedures = new Map();

            for (const [procedureCode, definitionId] of this.compilingProcedures.entries()) {
                const definitionBlock = target.blocks.getBlock(definitionId);
                const innerDefinition = target.blocks.getBlock(definitionBlock.inputs.custom_block.block);
                const bodyStart = definitionBlock.next;

                // Extract the function's warp mode.
                // See Sequencer.stepToProcedure
                let isWarp = false;
                if (innerDefinition && innerDefinition.mutation) {
                    const warp = innerDefinition.mutation.warp;
                    if (typeof warp === 'boolean') {
                        isWarp = warp;
                    } else if (typeof warp === 'string') {
                        isWarp = JSON.parse(warp);
                    }
                }

                const procedureLabel = this.compileHat(bodyStart);
                this.procedures[procedureCode] = {
                    warp: isWarp,
                    label: procedureLabel,
                };
            }
        }

        return {
            jumps: this.jumps,
            startingFunction: this.jumps[startingFunction],
            procedures: this.procedures,
        };
    }
}

Compiler.BlockUtil = BlockUtil;
Compiler.InputUtil = InputUtil;
Compiler.StatementUtil = StatementUtil;
Compiler.CompiledInput = CompiledInput;

module.exports = Compiler;
