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
const factoryNameVariablePool = new VariablePool('f');

/**
 * Variable pool used for generated script names.
 */
const generatorNameVariablePool = new VariablePool('g');

/**
 * @typedef {import('../sprites/rendered-target')} RenderedTarget
 */

/**
 * @typedef {function} CompiledScript
 */

/**
 * @typedef {Object} CompilationResult
 * @property {CompiledScript} startingFunction
 * @property {Object.<string, CompiledScript>} procedures
 */

class ScriptCompiler {
    /**
     * @param {Thread} thread
     * @param {string} topBlock
     */
    constructor(thread, topBlock) {
        /** @type {RenderedTarget} */
        this.target = thread.target;

        this.topBlock = topBlock;

        this.blocks = thread.blockContainer;

        this.runtime = this.target.runtime;

        /**
         * Whether this script is explicitly in warp mode.
         */
        this.isWarp = false;

        /**
         * Whether this script is a procedure definition.
         */
        this.isProcedure = false;

        /**
         * Set of the names of procedures that this procedure requires.
         * @type {Set.<string>}
         */
        this.requiredProcedures = new Set();

        /**
         * Factory variables.
         * These variables will be setup once when the script factory runs.
         * This is a map of Value to variable name.
         * It may seem backwards but it makes tracking identical values very efficient.
         * @type {Object.<string, string>}
         */
        this.factoryVariables = {};

        /**
         * Variable pool used for factory variables.
         */
        this.factoryVariablePool = new VariablePool('b');

        /**
         * Variable pool used for regular script variables.
         */
        this.primaryVariablePool = new VariablePool('a');
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
     * Generate the JS to pass into eval() to create the factory function.
     * @param {string} stack The generated script from compileStack
     * @private
     * @returns {string}
     */
    createScriptFactory(stack) {
        const scriptName = generatorNameVariablePool.next();
        const factoryName = factoryNameVariablePool.next();

        let script = '';

        // Factory
        script += `(function ${factoryName}(target) { `;
        script += 'const runtime = target.runtime; ';
        script += 'const stage = runtime.getTargetForStage();\n';
        for (const varValue of Object.keys(this.factoryVariables)) {
            const varName = this.factoryVariables[varValue];
            script += `const ${varName} = ${varValue};\n`;
        }

        // Generated script
        script += `return function* ${scriptName}(`;
        if (this.isProcedure) {
            // procedures accept single argument "C"
            script += 'C';
        }
        script += ') {\n';

        if (this.isWarp) {
            script += 'thread.warp++;\n';
        }
        
        script += stack;
        
        if (!this.isProcedure) {
            script += 'retire();\n';
        } else if (this.isWarp) {
            script += 'thread.warp--;\n';
        }

        script += '}; })';

        return script;
    }

    compile() {
        const compiledStack = this.compileStack(this.topBlock);
        const script = this.createScriptFactory(compiledStack);
        const fn = execute.scopedEval(script);
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
        this.thread = thread;

        /** @type {RenderedTarget} */
        this.target = thread.target;
        if (!this.target) throw new Error('no target');

        /** @type {Runtime} */
        this.runtime = this.target.runtime;

        /** @type {Blocks} */
        this.blocks = this.thread.blockContainer;

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
     * @param {string} topBlock The ID of the top block of the script. This block must not be a hat.
     * @param {object} opts
     * @param {boolean} [opts.isWarp]
     * @param {boolean} [opts.isProcedure]
     * @returns {CompiledScript}
     */
    compileScript(topBlock, opts) {
        const compiler = new ScriptCompiler(this.thread, topBlock);
        compiler.isWarp = !!opts.isWarp;
        compiler.isProcedure = !!opts.isProcedure;
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
     * @param {string} id
     */
    getTopBlock(id) {
        let block = this.blocks.getBlock(id);
        if (block) return block;

        block = this.runtime.flyoutBlocks.getBlock(id);
        if (block) return block;

        throw new Error('cannot find top block: ' + id);
    }

    /**
     * @returns {CompilationResult}
     */
    compile() {
        const target = this.target;
        if (!target) throw new Error('no target');

        const topBlock = this.getTopBlock(this.thread.topBlock);

        // If the top block is a hat, advance to its child.
        let startingBlock;
        if (this.runtime.getIsHat(topBlock.opcode)) {
            if (this.runtime.getIsEdgeActivatedHat(topBlock.opcode)) {
                // Edge-activated hats require special behavior.
                throw new Error('Not compiling an edge-activated hat');
            }
            startingBlock = topBlock.next;
        } else {
            startingBlock = this.thread.topBlock;
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
