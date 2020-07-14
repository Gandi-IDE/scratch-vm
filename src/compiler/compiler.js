const log = require('../util/log');
const Thread = require('../engine/thread');
const Runtime = require('../engine/runtime');
const Blocks = require('../engine/blocks');
const RenderedTarget = require('../sprites/rendered-target');

const CompilerHints = require('./hints');
const execute = require('./execute');

const statements = {};
const inputs = {};

const defaultExtensions = [
    require('./blocks/compiler_natives'),
    require('./blocks/compiler_scratch3_motion'),
    require('./blocks/compiler_scratch3_looks'),
    require('./blocks/compiler_scratch3_sound'),
    require('./blocks/compiler_scratch3_event'),
    require('./blocks/compiler_scratch3_control'),
    require('./blocks/compiler_scratch3_sensing'),
    require('./blocks/compiler_scratch3_operators'),
    require('./blocks/compiler_scratch3_data'),
    require('./blocks/compiler_scratch3_procedures'),
    require('./blocks/compiler_compat'),
    // TODO: do not load extensions immediately
    require('./extensions/compiler_pen'),
];

const TYPE_UNKNOWN = 0;
const TYPE_NUMBER = 1;
const TYPE_BOOLEAN = 2;
const TYPE_STRING = 3;

const FLAG_NANABLE = 1;

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
 * Useful to make sure that a method is always called, never accidentally stringified.
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

    // Expose some constants that are likely to be of use to blocks.
    get TYPE_UNKNOWN() { return TYPE_UNKNOWN; }
    get TYPE_NUMBER() { return TYPE_NUMBER; }
    get TYPE_BOOLEAN() { return TYPE_BOOLEAN; }
    get TYPE_STRING() { return TYPE_STRING; }
    get FLAG_NANABLE() { return FLAG_NANABLE; }

    /**
     * The target being compiled.
     * Note: This target might not represent the `target` found at runtime, as scripts can be shared between clones.
     */
    get target() {
        return this.compiler.target;
    }

    /**
     * The stage of the target's runtime.
     */
    get stage() {
        return this.compiler.runtime.getTargetForStage();
    }

    /**
     * Whether the target being compiled is a stage.
     * @type {boolean}
     */
    get isStage() {
        return !!this.target.isStage;
    }

    /**
     * Get the compiler hints.
     */
    get hints() {
        return this.compiler.hints;
    }

    /**
     * The block's opcode.
     * @type {string}
     */
    get opcode() {
        return this.block.opcode;
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
     * Get the name of all inputs in this block.
     * @returns {string[]}
     */
    allInputs() {
        return Object.keys(this.block.inputs);
    }

    /**
     * Get the name of all fields in this block.
     * @returns {string[]}
     */
    allFields() {
        return Object.keys(this.block.fields);
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
     * Yield script if not running in warp mode.
     * Does not change thread state.
     */
    yieldNotWarp() {
        if (!this.hints.isWarp) {
            this.writeLn('if (thread.warp === 0) yield;');
        }
    }

    /**
     * Pause script execution until threads complete.
     * @param {string} threads Threads to wait for, should be a call to startHats()
     */
    waitUntilThreadsComplete(threads) {
        this.writeLn(`yield* waitThreads(${threads});`);
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
     * Explicitly do nothing.
     */
    noop() {
        this.writeLn('/* no-op */');
    }

    /**
     * Stop this thread.
     */
    retire() {
        this.writeLn('retire(); yield;');
    }

    /**
     * Get a local variable.
     */
    var() {
        return this.compiler.nextVariable();
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
         */
        this.type = type;
        /**
         * Internal flags.
         * @private
         */
        this.flags = 0;
    }

    /**
     * Enable a flag.
     * @param {number} flag The value of the flag to enable.
     */
    setFlag(flag) {
        this.flags |= flag;
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
 * @typedef {Function} CompiledScript
 */

/**
 * @typedef {Object} CompilationResult
 * @property {Function} startingFunction
 * @property {Object.<string, CompiledScript>} procedures
 */

class Compiler {
    /**
     * @param {Thread} thread
     */
    constructor(thread) {
        /** @type {RenderedTarget} */
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

        /**
         * Compiled procedures.
         * @type {Object.<string, CompiledScript>}
         */
        this.procedures = {};

        /**
         * Number of local variables created.
         */
        this.variableCount = 0;

        /**
         * Compiler optimization/behavior hints.
         * This is set by compileScript.
         * @type {CompilerHints}
         */
        this.hints = undefined;

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

    /**
     * Compile a script.
     * @param {string} topBlock The ID of the top block of the script. This should not be the ID of the hat block.
     * @param {CompilerHints} hints
     */
    compileScript(topBlock, hints) {
        // blocks will read hints from here
        this.hints = hints;

        let script = '';

        script += 'function* g(';
        // Procedures accept arguments
        if (hints.isProcedure) {
            script += 'C';
        }
        script += ') {\n';

        // Increase warp level
        if (hints.isWarp) {
            script += 'thread.warp++;\n';
        } else if (hints.isProcedure) {
            script += 'if (thread.warp) thread.warp++;\n';
        }

        script += this.compileStack(topBlock);

        if (hints.isProcedure) {
            script += 'endCall();\n';
        } else {
            script += 'retire();\n';
        }

        script += '}';

        const fn = execute.createScriptFactory(script);
        log.info(`[${this.target.getName()}] compiled script`, script);
        return fn;
    }

    /**
     * Get the name of the next local variable.
     */
    nextVariable() {
        this.variableCount++;
        return 'a' + this.variableCount;
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
            if (this.runtime.getIsEdgeActivatedHat(topBlock.opcode)) {
                throw new Error('Not compiling an edge-activated hat');
            }
            startingBlock = topBlock.next;
        } else {
            startingBlock = this.topBlock;
        }
        const startingFunction = this.compileScript(startingBlock, new CompilerHints());

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

                const hints = new CompilerHints();
                hints.isProcedure = true;
                hints.isWarp = isWarp;

                const compiledProcedure = this.compileScript(bodyStart, hints);
                this.procedures[procedureCode] = compiledProcedure;
            }
        }

        return {
            startingFunction: startingFunction,
            procedures: this.procedures,
        };
    }
}

Compiler.BlockUtil = BlockUtil;
Compiler.InputUtil = InputUtil;
Compiler.StatementUtil = StatementUtil;
Compiler.CompiledInput = CompiledInput;

module.exports = Compiler;
