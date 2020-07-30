const log = require('../util/log');

class ASTGenerator {
    constructor (thread) {
        this.thread = thread;
        this.target = thread.target;
        this.blocks = thread.blockContainer;
        this.runtime = this.target.runtime;
        this.stage = this.runtime.getTargetForStage();
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
                opcode: 'constant',
                value: block.fields.NUM.value
            };
        case 'text':
            return {
                opcode: 'constant',
                value: block.fields.TEXT.value
            };

        case 'operator_gt':
            return {
                opcode: 'op.greater',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_lt':
            return {
                opcode: 'op.less',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_equals':
            return {
                opcode: 'op.equals',
                left: this.descendInput(block, 'OPERAND1'),
                right: this.descendInput(block, 'OPERAND2')
            };
        case 'operator_add':
            return {
                opcode: 'op.add',
                left: this.descendInput(block, 'NUM1'),
                right: this.descendInput(block, 'NUM2')
            };
        case 'operator_subtract':
            return {
                opcode: 'op.subtract',
                left: this.descendInput(block, 'NUM1'),
                right: this.descendInput(block, 'NUM2')
            };

        case 'data_variable':
            return {
                opcode: 'var.get',
                variable: this.descendVariable(block, 'VARIABLE')
            };
        case 'data_itemoflist':
            return {
                opcode: 'list.get',
                list: this.descendVariable(block, 'LIST')
            };

        default:
            log.warn('unknown input: ' + block.opcode, block);
            return {
                opcode: 'constant',
                value: '0'
            };
        }
    }

    descendStackedBlock (block) {
        switch (block.opcode) {
        case 'control_if':
            return {
                opcode: 'control.if',
                condition: this.descendInput(block, 'CONDITION'),
                whenTrue: this.descendSubstack(block, 'SUBSTACK'),
                whenFalse: []
            };
        case 'control_if_else':
            return {
                opcode: 'control.if',
                condition: this.descendInput(block, 'CONDITION'),
                whenTrue: this.descendSubstack(block, 'SUBSTACK'),
                whenFalse: this.descendSubstack(block, 'SUBSTACK2')
            };
        case 'control_while':
            return {
                opcode: 'control.while',
                condition: this.descendInput(block, 'CONDITION'),
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_repeat_until':
            return {
                opcode: 'control.while',
                condition: {
                    opcode: 'op.not',
                    operand: this.descendInput(block, 'CONDITION')
                },
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_forever':
            return {
                opcode: 'control.while',
                condition: {
                    opcode: 'constant',
                    value: true
                },
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_repeat':
            return {
                opcode: 'control.repeat',
                times: this.descendInput(block, 'TIMES'),
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_stop':
            return {
                opcode: 'control.stop',
                level: block.fields.STOP_OPTION.value
            };

        case 'data_setvariableto':
            return {
                opcode: 'var.set',
                var: this.descendVariable(block, 'VARIABLE'),
                value: this.descendInput(block, 'VALUE')
            };
        case 'data_changevariableby':
            return {
                opcode: 'var.change',
                var: this.descendVariable(block, 'VARIABLE'),
                value: this.descendInput(block, 'VALUE')
            };

        case 'data_replaceitemoflist':
            return {
                opcode: 'list.replace',
                index: this.descendInput(block, 'INDEX'),
                item: this.descendInput(block, 'ITEM')
            };

        case 'motion_movesteps':
            return {
                opcode: 'motion.steps',
                steps: this.descendInput(block, 'STEPS')
            };

        default:
            log.warn('unknown stacked block: ' + block.opcode, block);
            return {
                opcode: 'noop'
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

        debugger;
        // // Search for it by name and type
        // for (const varId in target.variables) {
        //     if (target.variables.hasOwnProperty(varId)) {
        //         const currVar = target.variables[varId];
        //         if (currVar.name === name && currVar.type === type) {
        //             return util.compiler.getOrCreateFactoryVariable(`target.variables["${util.safe(varId)}"]`);
        //         }
        //     }
        // }
        // if (!target.isStage) {
        //     if (stage) {
        //         for (const varId in stage.variables) {
        //             if (stage.variables.hasOwnProperty(varId)) {
        //                 const currVar = stage.variables[varId];
        //                 if (currVar.name === name && currVar.type === type) {
        //                     return util.compiler.getOrCreateFactoryVariable(`target.variables["${util.safe(varId)}"]`);
        //                 }
        //             }
        //         }
        //     }
        // }
        // // Should never happen.
        // throw new Error('cannot find variable: ' + id + ' (' + name + ')');
    }

    generate () {
        const topBlock = this.blocks.getBlock(this.thread.topBlock);

        // If the top block is a hat, advance to its child.
        let startingBlock;
        if (this.runtime.getIsHat(topBlock.opcode)) {
            if (this.runtime.getIsEdgeActivatedHat(topBlock.opcode)) {
                throw new Error('Not compiling an edge-activated hat');
            }
            startingBlock = topBlock.next;
        } else {
            startingBlock = this.thread.topBlock;
        }

        return {
            stack: this.walkStack(startingBlock)
        };
    }
}

module.exports = ASTGenerator;
