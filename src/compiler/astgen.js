const log = require('../util/log');

class ScriptTreeGenerator {
    constructor (thread) {
        this.thread = thread;
        this.target = thread.target;
        this.blocks = thread.blockContainer;
        this.runtime = this.target.runtime;
        this.stage = this.runtime.getTargetForStage();

        this.requiredProcedures = new Set();
        this.isProcedure = false;
        this.isWarp = false;
        this.arguments = [];
    }

    setIsProcedure (procedureCode) {
        this.isProcedure = true;

        const paramNamesIdsAndDefaults = this.blocks.getProcedureParamNamesIdsAndDefaults(procedureCode);
        if (paramNamesIdsAndDefaults === null) {
            throw new Error('tree generator cannot find procedure: ' + procedureCode);
        }

        const [paramNames, paramIds, paramDefaults] = paramNamesIdsAndDefaults;
        this.arguments = paramNames;
    }

    setIsWarp () {
        this.isWarp = true;
    }

    descendInput (parentBlock, inputName) {
        const input = parentBlock.inputs[inputName];
        const inputId = input.block;
        const block = this.blocks.getBlock(inputId);

        switch (block.opcode) {
        case 'math_angle':
        case 'math_number':
        case 'math_integer':
        case 'math_positive_number':
        case 'math_whole_number':
            return {
                kind: 'constant',
                value: block.fields.NUM.value
            };
        case 'text':
            return {
                kind: 'constant',
                value: block.fields.TEXT.value
            };

        case 'operator_gt':
            return {
                kind: 'op.greater',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_lt':
            return {
                kind: 'op.less',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_equals':
            return {
                kind: 'op.equals',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_add':
            return {
                kind: 'op.add',
                left: this.descendInput(block, 'NUM1'),
                right: this.descendInput(block, 'NUM2')
            };
        case 'operator_subtract':
            return {
                kind: 'op.subtract',
                left: this.descendInput(block, 'NUM1'),
                right: this.descendInput(block, 'NUM2')
            };
        case 'operator_divide':
            return {
                kind: 'op.divide',
                left: this.descendInput(block, 'NUM1'),
                right: this.descendInput(block, 'NUM2')
            };
        case 'operator_not':
            return {
                kind: 'op.not',
                operand: this.descendInput(block, 'OPERAND')
            };
        case 'operator_or':
            return {
                kind: 'op.or',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_and':
            return {
                kind: 'op.and',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_join':
            return {
                kind: 'op.join',
                left: this.descendInput(block, 'STRING1'),
                right: this.descendInput(block, 'STRING2')
            };

        case 'data_variable':
            return {
                kind: 'var.get',
                variable: this.descendVariable(block, 'VARIABLE')
            };
        case 'data_itemoflist':
            return {
                kind: 'list.get',
                list: this.descendVariable(block, 'LIST'),
                index: this.descendInput(block, 'INDEX')
            };
        case 'data_lengthoflist':
            return {
                kind: 'list.length',
                list: this.descendVariable(block, 'LIST')
            };

        case 'motion_xposition':
            return {
                kind: 'motion.x',
            };
        case 'motion_yposition':
            return {
                kind: 'motion.y',
            };

        case 'sensing_timer':
            return {
                kind: 'timer.get',
            };

        case 'argument_reporter_string_number': {
            if (!this.isProcedure) return {
                kind: 'constant',
                value: '0'
            };
            const value = block.fields.VALUE.value;
            if (!this.arguments.includes(value)) return {
                kind: 'constant',
                value: '0'
            };
            return {
                kind: 'args.stringNumber',
                name: value
            };
        }

        default:
            log.warn('AST: unknown input: ' + block.opcode, block);
            return {
                kind: 'constant',
                value: '0'
            };
        }
    }

    descendStackedBlock (block) {
        switch (block.opcode) {
        case 'control_if':
            return {
                kind: 'control.if',
                condition: this.descendInput(block, 'CONDITION'),
                whenTrue: this.descendSubstack(block, 'SUBSTACK'),
                whenFalse: []
            };
        case 'control_if_else':
            return {
                kind: 'control.if',
                condition: this.descendInput(block, 'CONDITION'),
                whenTrue: this.descendSubstack(block, 'SUBSTACK'),
                whenFalse: this.descendSubstack(block, 'SUBSTACK2')
            };
        case 'control_while':
            return {
                kind: 'control.while',
                condition: this.descendInput(block, 'CONDITION'),
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_repeat_until':
            return {
                kind: 'control.while',
                condition: {
                    kind: 'op.not',
                    operand: this.descendInput(block, 'CONDITION')
                },
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_forever':
            return {
                kind: 'control.while',
                condition: {
                    kind: 'constant',
                    value: true
                },
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_repeat':
            return {
                kind: 'control.repeat',
                times: this.descendInput(block, 'TIMES'),
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_stop':
            return {
                kind: 'control.stop',
                level: block.fields.STOP_OPTION.value
            };

        case 'data_setvariableto':
            return {
                kind: 'var.set',
                variable: this.descendVariable(block, 'VARIABLE'),
                value: this.descendInput(block, 'VALUE')
            };
        case 'data_changevariableby':
            return {
                kind: 'var.change',
                variable: this.descendVariable(block, 'VARIABLE'),
                value: this.descendInput(block, 'VALUE')
            };
        case 'data_hidevariable':
            return {
                kind: 'var.hide',
                variable: this.descendVariable(block, 'VARIABLE'),
            };
        case 'data_showvariable':
            return {
                kind: 'var.show',
                variable: this.descendVariable(block, 'VARIABLE'),
            };

        case 'data_replaceitemoflist':
            return {
                kind: 'list.replace',
                list: this.descendVariable(block, 'LIST'),
                index: this.descendInput(block, 'INDEX'),
                item: this.descendInput(block, 'ITEM')
            };
        case 'data_deletealloflist':
            return {
                kind: 'list.deleteAll',
                list: this.descendVariable(block, 'LIST')
            };
        case 'data_addtolist':
            return {
                kind: 'list.add',
                list: this.descendVariable(block, 'LIST'),
                item: this.descendInput(block, 'ITEM')
            };
        case 'data_hidelist':
            return {
                kind: 'list.hide',
                list: this.descendVariable(block, 'LIST'),
            };
        case 'data_showlist':
            return {
                kind: 'list.show',
                list: this.descendVariable(block, 'LIST'),
            };

        case 'motion_movesteps':
            return {
                kind: 'motion.step',
                steps: this.descendInput(block, 'STEPS')
            };
        case 'motion_gotoxy':
            return {
                kind: 'motion.setXY',
                x: this.descendInput(block, 'X'),
                y: this.descendInput(block, 'Y')
            };

        case 'looks_gotofrontback':
            return {
                kind: 'looks.goFrontBack',
                where: block.fields.FRONT_BACK.value === 'front' ? 'front' : 'back'
            };

        case 'sensing_resettimer':
            return {
                kind: 'timer.reset'
            };

        case 'procedures_call': {
            const procedureCode = block.mutation.proccode;
            const paramNamesIdsAndDefaults = this.blocks.getProcedureParamNamesIdsAndDefaults(procedureCode);
            if (paramNamesIdsAndDefaults === null) {
                return {
                    kind: 'noop'
                };
            }

            const [paramNames, paramIds, paramDefaults] = paramNamesIdsAndDefaults;
            this.requiredProcedures.add(procedureCode);

            const parameters = {};
            for (let i = 0; i < paramIds.length; i++) {
                let value;
                if (block.inputs.hasOwnProperty(paramIds[i])) {
                    value = this.descendInput(block, paramIds[i]);
                } else {
                    value = {
                        kind: 'constant',
                        value: paramDefaults[i],
                    };
                }
                // overwriting existing values is intentional
                parameters[paramNames[i]] = value;
            }

            return {
                kind: 'procedures.call',
                code: procedureCode,
                parameters
            };
        }

        default:
            log.warn('AST: unknown stacked block: ' + block.opcode, block);
            return {
                kind: 'noop'
            };
        }
    }

    descendSubstack (parentBlock, substackName) {
        const input = parentBlock.inputs[substackName];
        if (!input) {
            return [];
        }
        const stackId = input.block;
        return this.walkStack(stackId);
    }

    walkStack (startingBlockId) {
        const result = [];
        let blockId = startingBlockId;

        while (blockId !== null) {
            const block = this.blocks.getBlock(blockId);
            if (!block) {
                throw new Error('no block');
            }

            const node = this.descendStackedBlock(block);
            result.push(node);

            blockId = block.next;
        }

        return result;
    }

    descendVariable (block, variableName) {
        const variable = block.fields[variableName];
        const id = variable.id;

        const target = this.target;
        const stage = this.stage;

        if (target.variables.hasOwnProperty(id)) {
            return {
                scope: 'target',
                id
            };
        }

        if (!target.isStage) {
            if (stage && stage.variables.hasOwnProperty(id)) {
                return {
                    scope: 'stage',
                    id
                };
            }
        }
        // todo: create if doesn't exist
        throw new Error('cannot find variable: ' + id + ' (' + variableName + ')');
    }

    generate (topBlockId) {
        const topBlock = this.blocks.getBlock(topBlockId);

        // If the top block is a hat, advance to its child.
        let entryBlock;
        if (this.runtime.getIsHat(topBlock.opcode)) {
            if (this.runtime.getIsEdgeActivatedHat(topBlock.opcode)) {
                throw new Error('Not compiling an edge-activated hat');
            }
            entryBlock = topBlock.next;
        } else {
            entryBlock = topBlockId;
        }

        const stack = this.walkStack(entryBlock);

        return {
            stack,
            isProcedure: this.isProcedure,
            isWarp: this.isWarp,
        };
    }
}

class ASTGenerator {
    constructor (thread) {
        this.thread = thread;
        this.blocks = thread.blockContainer;

        this.uncompiledProcedures = new Map();
        this.compilingProcedures = new Map();
        this.procedures = {};
    }

    generateScriptTree (generator, topBlockId) {
        const result = generator.generate(topBlockId);

        for (const procedureCode of generator.requiredProcedures) {
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
            const definition = this.blocks.getProcedureDefinition(procedureCode);
            this.uncompiledProcedures.set(procedureCode, definition);
        }

        return result;
    }

    generate () {
        const entry = this.generateScriptTree(new ScriptTreeGenerator(this.thread), this.thread.topBlock);

        // Compile any required procedures.
        // As procedures can depend on other procedures, this process may take several iterations.
        while (this.uncompiledProcedures.size > 0) {
            this.compilingProcedures = this.uncompiledProcedures;
            this.uncompiledProcedures = new Map();

            for (const [procedureCode, definitionId] of this.compilingProcedures.entries()) {
                const definitionBlock = this.blocks.getBlock(definitionId);
                const innerDefinition = this.blocks.getBlock(definitionBlock.inputs.custom_block.block);
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

                const generator = new ScriptTreeGenerator(this.thread);
                generator.setIsProcedure(procedureCode, isWarp);
                if (isWarp) generator.setIsWarp();
                const compiledProcedure = this.generateScriptTree(generator, bodyStart);
                this.procedures[procedureCode] = compiledProcedure;
            }
        }

        return {
            entry: entry,
            procedures: this.procedures,
        };
    }
}

module.exports = ASTGenerator;
