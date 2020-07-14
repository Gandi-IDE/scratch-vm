const CompiledInput = require('./input');

class BlockUtil {
    /**
     * @param {import('./compiler').ScriptCompiler} compiler
     */
    constructor(compiler, block) {
        this.compiler = compiler;
        this.block = block;
    }

    // Expose some constants that are likely to be of use to blocks.
    get TYPE_UNKNOWN() { return CompiledInput.TYPE_UNKNOWN; }
    get TYPE_NUMBER() { return CompiledInput.TYPE_NUMBER; }
    get TYPE_BOOLEAN() { return CompiledInput.TYPE_BOOLEAN; }
    get TYPE_STRING() { return CompiledInput.TYPE_STRING; }
    get FLAG_NANABLE() { return CompiledInput.FLAG_NANABLE; }

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
            return new CompiledInput('""', CompiledInput.TYPE_STRING);
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
        return new CompiledInput(source, CompiledInput.TYPE_UNKNOWN);
    }

    number(source) {
        return new CompiledInput(source, CompiledInput.TYPE_NUMBER);
    }

    boolean(source) {
        return new CompiledInput(source, CompiledInput.TYPE_BOOLEAN);
    }

    string(source) {
        return new CompiledInput(source, CompiledInput.TYPE_STRING);
    }

    fieldString(name) {
        return new CompiledInput(`"${this.safe(this.fieldValueUnsafe(name))}"`, CompiledInput.TYPE_STRING);
    }

    noop() {
        return new CompiledInput('/* no-op */ undefined', CompiledInput.TYPE_UNKNOWN);
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
        if (!this.compiler.isWarp) {
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
        return this.compiler.primaryVariablePool.next();
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

module.exports.BlockUtil = BlockUtil;
module.exports.InputUtil = InputUtil;
module.exports.StatementUtil = StatementUtil;
