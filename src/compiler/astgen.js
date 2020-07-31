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
            throw new Error(`AST: cannot find procedure: ${procedureCode}`);
        }

        const [paramNames, _paramIds, _paramDefaults] = paramNamesIdsAndDefaults;
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
        case 'colour_picker': {
            const color = block.fields.COLOUR.value;
            const hex = color.substr(1);
            if (/^[0-9a-f]{6,8}$/.test(hex)) {
                return {
                    kind: 'constant',
                    value: Number.parseInt(hex, 16)
                };
            }
            return {
                kind: 'constant',
                value: color
            };
        }
        case 'math_angle':
        case 'math_integer':
        case 'math_number':
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

        case 'argument_reporter_string_number': {
            if (!this.isProcedure) {
                return {
                    kind: 'constant',
                    value: 0
                };
            }
            const name = block.fields.VALUE.value;
            if (!this.arguments.includes(name)) {
                return {
                    kind: 'constant',
                    value: 0
                };
            }
            return {
                kind: 'args.stringNumber',
                name: name
            };
        }
        case 'argument_reporter_boolean': {
            if (!this.isProcedure) {
                return {
                    kind: 'constant',
                    value: false
                };
            }
            const name = block.fields.VALUE.value;
            if (!this.arguments.includes(name)) {
                return {
                    kind: 'constant',
                    value: false
                };
            }
            return {
                kind: 'args.boolean',
                name: name
            };
        }

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
        case 'data_listcontainsitem':
            return {
                kind: 'list.contains',
                list: this.descendVariable(block, 'LIST'),
                item: this.descendInput(block, 'INPUT')
            };
        case 'data_itemnumoflist':
            return {
                kind: 'list.index',
                list: this.descendVariable(block, 'LIST'),
                item: this.descendInput(block, 'INPUT')
            };
        case 'data_listcontents':
            return {
                kind: 'list.contents',
                list: this.descendVariable(block, 'LIST')
            };


        case 'event_broadcast_menu':
            return {
                kind: 'constant',
                value: block.fields.BROADCAST_INPUT.value
            };

        case 'motion_xposition':
            return {
                kind: 'motion.x'
            };
        case 'motion_yposition':
            return {
                kind: 'motion.y'
            };

        case 'operator_add':
            return {
                kind: 'op.add',
                left: this.descendInput(block, 'NUM1'),
                right: this.descendInput(block, 'NUM2')
            };
        case 'operator_and':
            return {
                kind: 'op.and',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_contains':
            return {
                kind: 'op.contains',
                // todo: better names
                string: this.descendInput(block, 'STRING1'),
                contains: this.descendInput(block, 'STRING2')
            };
        case 'operator_divide':
            return {
                kind: 'op.divide',
                left: this.descendInput(block, 'NUM1'),
                right: this.descendInput(block, 'NUM2')
            };
        case 'operator_equals':
            return {
                kind: 'op.equals',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_gt':
            return {
                kind: 'op.greater',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_join':
            return {
                kind: 'op.join',
                left: this.descendInput(block, 'STRING1'),
                right: this.descendInput(block, 'STRING2')
            };
        case 'operator_length':
            return {
                kind: 'op.length',
                string: this.descendInput(block, 'STRING')
            };
        case 'operator_letter_of':
            return {
                kind: 'op.letterOf',
                letter: this.descendInput(block, 'LETTER'),
                string: this.descendInput(block, 'STRING')
            };
        case 'operator_lt':
            return {
                kind: 'op.less',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_mathop': {
            const value = this.descendInput(block, 'NUM');
            switch (block.fields.OPERATOR.value) {
            case 'abs': return {
                kind: 'op.abs',
                value
            };
            case 'floor': return {
                kind: 'op.floor',
                value
            };
            case 'ceiling': return {
                kind: 'op.ceiling',
                value
            };
            case 'sqrt': return {
                kind: 'op.sqrt',
                value
            };
            case 'sin': return {
                kind: 'op.sin',
                value
            };
            case 'cos': return {
                kind: 'op.cos',
                value
            };
            case 'tan': return {
                kind: 'op.tan',
                value
            };
            case 'asin': return {
                kind: 'op.asin',
                value
            };
            case 'acos': return {
                kind: 'op.acos',
                value
            };
            case 'atan': return {
                kind: 'op.atan',
                value
            };
            case 'ln': return {
                kind: 'op.ln',
                value
            };
            case 'log': return {
                kind: 'op.log10',
                value
            };
            case 'e ^': return {
                kind: 'op.e^',
                value
            };
            case '10 ^': return {
                kind: 'op.10^',
                value
            };
            default: return {
                kind: 'constant',
                value: 0
            };
            }
        }

        case 'operator_mod':
            return {
                kind: 'op.mod',
                left: this.descendInput(block, 'NUM1'),
                right: this.descendInput(block, 'NUM2')
            };
        case 'operator_multiply':
            return {
                kind: 'op.multiply',
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
        case 'operator_round':
            return {
                kind: 'op.round',
                value: this.descendInput(block, 'NUM')
            };
        case 'operator_subtract':
            return {
                kind: 'op.subtract',
                left: this.descendInput(block, 'NUM1'),
                right: this.descendInput(block, 'NUM2')
            };

        case 'sensing_mousedown':
            return {
                kind: 'sensing.mousedown'
            };
        case 'sensing_timer':
            return {
                kind: 'sensing.getTimer'
            };
        case 'sensing_username':
            return {
                kind: 'sensing.username'
            };

        default:
            log.warn(`AST: Unknown input: ${block.opcode}`, block);
            throw new Error(`AST: Unknown input: ${block.opcode}`);
        }
    }

    descendStackedBlock (block) {
        switch (block.opcode) {
        case 'control_delete_this_clone':
            return {
                kind: 'control.deleteClone'
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
        case 'control_repeat':
            return {
                kind: 'control.repeat',
                times: this.descendInput(block, 'TIMES'),
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
        case 'control_stop':
            return {
                kind: 'control.stop',
                level: block.fields.STOP_OPTION.value
            };
        case 'control_wait':
            return {
                kind: 'control.wait',
                seconds: this.descendInput(block, 'DURATION')
            };
        case 'control_wait_until':
            return {
                kind: 'control.waitUntil',
                until: this.descendInput(block, 'CONDITION')
            };
        case 'control_while':
            return {
                kind: 'control.while',
                condition: this.descendInput(block, 'CONDITION'),
                do: this.descendSubstack(block, 'SUBSTACK')
            };

        case 'data_addtolist':
            return {
                kind: 'list.add',
                list: this.descendVariable(block, 'LIST'),
                item: this.descendInput(block, 'ITEM')
            };
        case 'data_changevariableby':
            return {
                kind: 'var.change',
                variable: this.descendVariable(block, 'VARIABLE'),
                value: this.descendInput(block, 'VALUE')
            };
        case 'data_deletealloflist':
            return {
                kind: 'list.deleteAll',
                list: this.descendVariable(block, 'LIST')
            };
        case 'data_deleteoflist':
            return {
                kind: 'list.delete',
                list: this.descendVariable(block, 'LIST'),
                index: this.descendInput(block, 'INDEX')
            };
        case 'data_hidelist':
            return {
                kind: 'list.setVisible',
                list: this.descendVariable(block, 'LIST'),
                visible: false
            };
        case 'data_hidevariable':
            return {
                kind: 'var.setVisible',
                variable: this.descendVariable(block, 'VARIABLE'),
                visible: false
            };
        case 'data_insertatlist':
            return {
                kind: 'list.insert',
                list: this.descendVariable(block, 'LIST'),
                index: this.descendInput(block, 'INDEX'),
                item: this.descendInput(block, 'ITEM')
            };
        case 'data_replaceitemoflist':
            return {
                kind: 'list.replace',
                list: this.descendVariable(block, 'LIST'),
                index: this.descendInput(block, 'INDEX'),
                item: this.descendInput(block, 'ITEM')
            };
        case 'data_setvariableto':
            return {
                kind: 'var.set',
                variable: this.descendVariable(block, 'VARIABLE'),
                value: this.descendInput(block, 'VALUE')
            };
        case 'data_showlist':
            return {
                kind: 'list.setVisible',
                list: this.descendVariable(block, 'LIST'),
                visible: true
            };
        case 'data_showvariable':
            return {
                kind: 'var.setVisible',
                variable: this.descendVariable(block, 'VARIABLE'),
                visible: true
            };

        case 'event_broadcast':
            return {
                kind: 'event.broadcast',
                broadcast: this.descendInput(block, 'BROADCAST_INPUT')
            };

        case 'looks_cleargraphiceffects':
            return {
                kind: 'looks.clearEffects'
            };
        case 'looks_gotofrontback':
            return {
                kind: 'looks.goFrontBack',
                where: block.fields.FRONT_BACK.value === 'front' ? 'front' : 'back'
            };
        case 'looks_hide':
            return {
                kind: 'looks.setVisible',
                visible: false
            };
        case 'looks_setsizeto':
            return {
                kind: 'looks.setSize',
                size: this.descendInput(block, 'SIZE')
            };
        case 'looks_show':
            return {
                kind: 'looks.setVisible',
                visible: true
            };

        case 'motion_gotoxy':
            return {
                kind: 'motion.setXY',
                x: this.descendInput(block, 'X'),
                y: this.descendInput(block, 'Y')
            };
        case 'motion_movesteps':
            return {
                kind: 'motion.step',
                steps: this.descendInput(block, 'STEPS')
            };

        case 'pen_clear':
            return {
                kind: 'pen.clear'
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
                        value: paramDefaults[i]
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

        case 'pen_penDown':
            return {
                kind: 'pen.down'
            };
        case 'pen_setPenColorToColor':
            return {
                kind: 'pen.setColor',
                color: this.descendInput(block, 'COLOR')
            };
        case 'pen_setPenSizeTo':
            return {
                kind: 'pen.setSize',
                size: this.descendInput(block, 'SIZE')
            };
        case 'pen_stamp':
            return {
                kind: 'pen.stamp'
            };
        case 'pen_penUp':
            return {
                kind: 'pen.up'
            };
                
        case 'sensing_resettimer':
            return {
                kind: 'sensing.resetTimer'
            };

        default:
            log.warn(`AST: Unknown stacked block: ${block.opcode}`, block);
            throw new Error(`AST: Unknown stacked block: ${block.opcode}`);
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
        throw new Error(`cannot find variable: ${id} (${variableName})`);
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
            isWarp: this.isWarp
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
            procedures: this.procedures
        };
    }
}

module.exports = ASTGenerator;
