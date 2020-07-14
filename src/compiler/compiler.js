const log = require('../util/log');
const Thread = require('../engine/thread');
const Runtime = require('../engine/runtime');
const Blocks = require('../engine/blocks');
const RenderedTarget = require('../sprites/rendered-target');

const VariablePool = require('./variable-pool');
const { InputUtil, StatementUtil } = require('./compiler-util');
const CompiledInput = require('./input');
const execute = require('./execute');
const defaultExtensions = require('./default-extensions');

const statements = {};
const inputs = {};

defaultExtensions.forEach((ext) => {
    const extensionInputs = ext.getInputs();
    for (const op in extensionInputs) {
        if (extensionInputs.hasOwnProperty(op)) {
            if (inputs.hasOwnProperty(op)) {
                log.warn(`input opcode ${op} already exists, replacing previous definition.`);
            }
            inputs[op] = extensionInputs[op];
        }
    }

    const extensionStatements = ext.getStatements();
    for (const op in extensionStatements) {
        if (extensionStatements.hasOwnProperty(op)) {
            if (statements.hasOwnProperty(op)) {
                log.warn(`statement opcode ${op} already exists, replacing previous definition.`);
            }
            statements[op] = extensionStatements[op];
        }
    }
});

/**
 * Variable pool used for factory function names.
 */
const factoryVariablePool = new VariablePool('f');

/**
 * Variable pool used for generated script names.
 */
const generatorVariablePool = new VariablePool('g');

/**
 * @typedef {function} CompiledScript
 */

/**
 * @typedef {Object} CompilationResult
 * @property {CompiledScript} startingFunction
 * @property {Object.<string, CompiledScript>} procedures
 */

class ScriptCompiler {
    constructor(target, topBlock) {
        this.target = target;

        this.runtime = this.target.runtime;

        this.blocks = this.target.blocks;

        this.isWarp = false;

        this.isProcedure = false;

        this.topBlock = topBlock;

        this.requiredProcedures = new Set();

        /**
         * Factory variables.
         * These variables will be setup once when the script factory runs.
         * This is a map of Value to variable name.
         * It may seem backwards but it makes tracking identical values very efficient.
         * @type {Object.<string, string>}
         */
        this.factoryVariables = {};

        this.primaryVariablePool = new VariablePool('a');

        this.factoryVariablePool = new VariablePool('b');
    }

    /**
     * Ask the compiler to queue the compilation of a procedure.
     * This will do nothing if the procedure is already compiled or queued.
     * @param {string} procedureCode The procedure's code
     */
    dependProcedure(procedureCode) {
        this.requiredProcedures.add(procedureCode);
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

    compile() {
        const scriptName = generatorVariablePool.next();
        const factoryName = factoryVariablePool.next();

        let scriptFunction = '';

        // prepare the script
        scriptFunction += `function* ${scriptName}(`;
        // Procedures accept arguments
        if (this.isProcedure) {
            scriptFunction += 'C';
        }
        scriptFunction += ') {\n';

        // Increase warp level
        if (this.isWarp) {
            scriptFunction += 'thread.warp++;\n';
        } else if (this.isProcedure) {
            scriptFunction += 'if (thread.warp) thread.warp++;\n';
        }

        scriptFunction += this.compileStack(this.topBlock);

        if (this.isProcedure) {
            scriptFunction += 'endCall();\n';
        } else {
            scriptFunction += 'retire();\n';
        }

        scriptFunction += '}';

        let script = '';

        // prepare the factory
        script += `(function ${factoryName}(target) { `;
        script += 'var runtime = target.runtime; ';
        script += 'var stage = runtime.getTargetForStage();\n';

        // insert factory variables
        for (const data of Object.keys(this.factoryVariables)) {
            const varName = this.factoryVariables[data];
            script += `var ${varName} = ${data};\n`;
        }

        // return an instance of the function
        script += `return ${scriptFunction};\n });`;

        const fn = execute.createScriptFactory(script);
        log.info(`[${this.target.getName()}] compiled script`, script);
        return fn;
    }

    /**
     * Create or get a factory variable.
     * @param {string} value The value of the factory variable.
     */
    getOrCreateFactoryVariable(value) {
        if (this.factoryVariables.hasOwnProperty(value)) {
            return this.factoryVariables[value];
        }
        const variableName = this.factoryVariablePool.next();
        this.factoryVariables[value] = variableName;
        return variableName;
    }
}

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
         * TODO: don't copy all of the already compiled procedures?
         * @type {Object.<string, CompiledScript>}
         */
        this.procedures = Object.assign({}, this.blocks._cache.compiledProcedures);

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
     * Compile a script.
     * @param {string} topBlock The ID of the top block of the script. This should not be the ID of the hat block.
     * @returns {CompiledScript}
     */
    compileScript(topBlock, { isProcedure, isWarp }) {
        const compiler = new ScriptCompiler(this.target, topBlock);
        compiler.isWarp = isWarp;
        compiler.isProcedure = isProcedure;
        const fn = compiler.compile();

        for (const procedureCode of compiler.requiredProcedures) {
            if (this.procedures.hasOwnProperty(procedureCode)) {
                // already compiled
                continue;
            }
            if (this.compilingProcedures.has(procedureCode)) {
                // being compiled
                continue;
            }
            if (this.uncompiledProcedures.has(procedureCode)) {
                // queued to be compiled
                continue;
            }
            const definition = this.target.blocks.getProcedureDefinition(procedureCode);
            this.uncompiledProcedures.set(procedureCode, definition);
        }

        return fn;
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
        const startingFunction = this.compileScript(startingBlock, { isProcedure: false, isWarp: false });

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

                const compiledProcedure = this.compileScript(bodyStart, { isProcedure: true, isWarp: isWarp, });
                this.procedures[procedureCode] = compiledProcedure;
            }
        }

        for (const procedureCode of Object.keys(this.procedures)) {
            if (!this.blocks._cache.compiledProcedures.hasOwnProperty(procedureCode)) {
                this.blocks._cache.compiledProcedures[procedureCode] = this.procedures[procedureCode];
            }
        }

        return {
            startingFunction: startingFunction,
            procedures: this.procedures,
        };
    }
}

module.exports = Compiler;
module.exports.ScriptCompiler = ScriptCompiler;
