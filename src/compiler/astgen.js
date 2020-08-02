const Cast = require('../util/cast');
const Variable = require('../engine/variable');
const log = require('../util/log');

const SCALAR_TYPE = Variable.SCALAR_TYPE;
const LIST_TYPE = Variable.LIST_TYPE;

const compatBlocks = require('./compat-blocks');

/**
 * @typedef Tree
 * @property {null|Array} stack The nodes that comprise this script. `null` is an empty stack.
 * @property {boolean} isProcedure
 * @property {boolean} isWarp
 * @property {Array} dependedProcedures
 */

/**
 * @typedef AST
 * @property {Tree} entry
 * @property {Object.<String, Tree>} procedures
 */

// I would like to make a JSDoc type for "needs to have a string `kind` but can have any other properties" but that doesn't seem to be possible...
/**
 * @typedef {Object.<string, *>} Node
 * @property {string} kind
 */

const createVariableData = (scope, varObj) => ({
    scope,
    // todo: maybe just return varObj
    id: varObj.id,
    name: varObj.name,
    isCloud: varObj.isCloud
});

class ScriptTreeGenerator {
    constructor (thread) {
        this.thread = thread;
        this.target = thread.target;
        this.blocks = thread.blockContainer;
        this.runtime = this.target.runtime;
        this.stage = this.runtime.getTargetForStage();

        /**
         * List of procedures that this script depends on.
         */
        this.dependedProcedures = [];

        /**
         * Whether the current script is a procedure definition.
         */
        this.isProcedure = false;

        /**
         * Whether the current script is explicitly in warp mode.
         */
        this.isWarp = false;

        /**
         * The names of the arguments accepted by this script, in order.
         * @type {string[]}
         */
        this.procedureArguments = [];

        /**
         * Cache of variable ID to variable data object.
         * @type {object.<string, object>}
         */
        this.variableCache = {};
    }

    setProcedureCode (procedureCode) {
        this.isProcedure = true;

        const paramNamesIdsAndDefaults = this.blocks.getProcedureParamNamesIdsAndDefaults(procedureCode);
        if (paramNamesIdsAndDefaults === null) {
            throw new Error(`AST: cannot find procedure: ${procedureCode}`);
        }

        const [paramNames, _paramIds, _paramDefaults] = paramNamesIdsAndDefaults;
        this.procedureArguments = paramNames;
    }

    enableWarp () {
        this.isWarp = true;
    }

    /**
     * Descend into an input. (eg. "length of ( )")
     * @param {*} parentBlock The parent Scratch block that contains the input.
     * @param {string} inputName The name of the input to descend into.
     * @returns {Node} Compiled input node for this input.
     */
    descendInput (parentBlock, inputName) {
        const input = parentBlock.inputs[inputName];
        if (!input) {
            log.warn(`AST: ${parentBlock.opcode}: missing input ${inputName}`, parentBlock);
            return {
                kind: 'constant',
                value: 0
            };
        }
        const inputId = input.block;
        const block = this.blocks.getBlock(inputId);
        if (!block) {
            log.warn(`AST: ${parentBlock.opcode}: could not find input ${inputName} with ID ${inputId}`);
            return {
                kind: 'constant',
                value: 0
            };
        }

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
            if (!this.procedureArguments.includes(name)) {
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
            if (!this.procedureArguments.includes(name)) {
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

        case 'control_create_clone_of_menu':
            return {
                kind: 'constant',
                value: block.fields.CLONE_OPTION.value
            };

        case 'data_variable':
            return {
                kind: 'var.get',
                variable: this.descendVariable(block, 'VARIABLE', SCALAR_TYPE)
            };
        case 'data_itemoflist':
            return {
                kind: 'list.get',
                list: this.descendVariable(block, 'LIST', LIST_TYPE),
                index: this.descendInput(block, 'INDEX')
            };
        case 'data_lengthoflist':
            return {
                kind: 'list.length',
                list: this.descendVariable(block, 'LIST', LIST_TYPE)
            };
        case 'data_listcontainsitem':
            return {
                kind: 'list.contains',
                list: this.descendVariable(block, 'LIST', LIST_TYPE),
                item: this.descendInput(block, 'ITEM')
            };
        case 'data_itemnumoflist':
            return {
                kind: 'list.indexOf',
                list: this.descendVariable(block, 'LIST', LIST_TYPE),
                item: this.descendInput(block, 'ITEM')
            };
        case 'data_listcontents':
            return {
                kind: 'list.contents',
                list: this.descendVariable(block, 'LIST', LIST_TYPE)
            };

        case 'event_broadcast_menu':
            return {
                kind: 'constant',
                value: block.fields.BROADCAST_OPTION.value
            };

        case 'looks_backdropnumbername':
            if (block.fields.NUMBER_NAME.value === 'number') {
                return {
                    kind: 'looks.backdropNumber'
                };
            }
            return {
                kind: 'looks.backdropName'
            };
        case 'looks_backdrops':
            return {
                kind: 'constant',
                value: block.fields.BACKDROP.value
            };
        case 'looks_costume':
            return {
                kind: 'constant',
                value: block.fields.COSTUME.value
            };
        case 'looks_costumenumbername':
            if (block.fields.NUMBER_NAME.value === 'number') {
                return {
                    kind: 'looks.costumeNumber'
                };
            }
            return {
                kind: 'looks.costumeName'
            };
        case 'looks_size':
            return {
                kind: 'looks.size'
            };

        case 'motion_direction':
            return {
                kind: 'motion.direction'
            };
        case 'motion_glideto_menu':
            return {
                kind: 'constant',
                value: block.fields.TO.value
            };
        case 'motion_goto_menu':
            return {
                kind: 'constant',
                value: block.fields.TO.value
            };
        case 'motion_pointtowards_menu':
            return {
                kind: 'constant',
                value: block.fields.TOWARDS.value
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
                kind: 'op.log',
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
        case 'operator_random': {
            const from = this.descendInput(block, 'FROM');
            const to = this.descendInput(block, 'TO');
            // If both values are known at compile time, we can do some optimizations.
            if (from.kind === 'constant' && to.kind === 'constant') {
                const sFrom = from.value;
                const sTo = to.value;
                const nFrom = Cast.toNumber(sFrom);
                const nTo = Cast.toNumber(sTo);
                // If both numbers are the same, remove the random
                // todo: this probably never happens so consider removing
                if (nFrom === nTo) {
                    return {
                        kind: 'constant',
                        value: nFrom
                    };
                }
                // If both are ints, hint this to the compiler
                if (Cast.isInt(sFrom) && Cast.isInt(sTo)) {
                    return {
                        kind: 'op.random',
                        low: nFrom <= nTo ? from : to,
                        high: nFrom <= nTo ? to : from,
                        useInts: true,
                        useFloats: false
                    };
                }
                // Otherwise hint that these are floats
                return {
                    kind: 'op.random',
                    low: nFrom <= nTo ? from : to,
                    high: nFrom <= nTo ? to : from,
                    useInts: false,
                    useFloats: true
                };
            } else if (from.kind === 'constant') {
                if (!Cast.isInt(Cast.toNumber(from.value))) {
                    return {
                        kind: 'op.random',
                        low: from,
                        high: to,
                        useInts: false,
                        useFloats: true
                    };
                }
            } else if (to.kind === 'constant') {
                if (!Cast.isInt(Cast.toNumber(to.value))) {
                    return {
                        kind: 'op.random',
                        low: from,
                        high: to,
                        checkedOrder: false,
                        useInts: false,
                        useFloats: true
                    };
                }
            }
            // No optimizations possible
            return {
                kind: 'op.random',
                low: from,
                high: to,
                checkedOrder: false,
                useInts: false,
                useFloats: false
            };
        }
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

        case 'pen_menu_colorParam':
            return {
                kind: 'constant',
                value: block.fields.colorParam.value
            };

        case 'sensing_coloristouchingcolor':
            return {
                kind: 'sensing.colorTouchingColor',
                target: this.descendInput(block, 'COLOR2'),
                mask: this.descendInput(block, 'COLOR')
            };
        case 'sensing_distancetomenu':
            return {
                kind: 'constant',
                value: block.fields.DISTANCETOMENU.value
            };
        case 'sensing_keyoptions':
            return {
                kind: 'constant',
                value: block.fields.KEY_OPTION.value
            };
        case 'sensing_keypressed':
            return {
                kind: 'sensing.keydown',
                key: this.descendInput(block, 'KEY_OPTION')
            };
        case 'sensing_mousedown':
            return {
                kind: 'sensing.mousedown'
            };
        case 'sensing_mousey':
            return {
                kind: 'sensing.mouseY'
            };
        case 'sensing_mousex':
            return {
                kind: 'sensing.mouseX'
            };
        case 'sensing_of_object_menu':
            return {
                kind: 'constant',
                value: block.fields.OBJECT.value
            };
        case 'sensing_timer':
            return {
                kind: 'sensing.timer'
            };
        case 'sensing_touchingcolor':
            return {
                kind: 'sensing.touchingColor',
                color: this.descendInput(block, 'COLOR')
            };
        case 'sensing_touchingobject':
            return {
                kind: 'sensing.touching',
                object: this.descendInput(block, 'TOUCHINGOBJECTMENU')
            };
        case 'sensing_touchingobjectmenu':
            return {
                kind: 'constant',
                value: block.fields.TOUCHINGOBJECTMENU.value
            };
        case 'sensing_username':
            return {
                kind: 'sensing.username'
            };

        case 'sound_sounds_menu':
            return {
                kind: 'constant',
                value: block.fields.SOUND_MENU.value
            };

        default:
            // It might be a block that uses the compatibility layer
            if (compatBlocks.inputs.includes(block.opcode)) {
                return this.descendCompatLayer(block);
            }
            log.warn(`AST: Unknown input: ${block.opcode}`, block);
            throw new Error(`AST: Unknown input: ${block.opcode}`);
        }
    }

    /**
     * Descend into a stacked block. (eg. "move ( ) steps")
     * @param {*} block The Scratch block to parse.
     * @returns {Node} Compiled node for this block.
     */
    descendStackedBlock (block) {
        switch (block.opcode) {
        case 'control_create_clone_of':
            return {
                kind: 'control.createClone',
                target: this.descendInput(block, 'CLONE_OPTION')
            };
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
        case 'control_for_each':
            return {
                kind: 'control.for',
                variable: this.descendVariable(block, 'VARIABLE', SCALAR_TYPE),
                count: this.descendInput(block, 'VALUE'),
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
                condition: this.descendInput(block, 'CONDITION')
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
                list: this.descendVariable(block, 'LIST', LIST_TYPE),
                item: this.descendInput(block, 'ITEM')
            };
        case 'data_changevariableby':
            return {
                kind: 'var.change',
                variable: this.descendVariable(block, 'VARIABLE', SCALAR_TYPE),
                value: this.descendInput(block, 'VALUE')
            };
        case 'data_deletealloflist':
            return {
                kind: 'list.deleteAll',
                list: this.descendVariable(block, 'LIST', LIST_TYPE)
            };
        case 'data_deleteoflist':
            return {
                kind: 'list.delete',
                list: this.descendVariable(block, 'LIST', LIST_TYPE),
                index: this.descendInput(block, 'INDEX')
            };
        case 'data_hidelist':
            return {
                kind: 'list.hide',
                list: this.descendVariable(block, 'LIST', LIST_TYPE)
            };
        case 'data_hidevariable':
            return {
                kind: 'var.hide',
                variable: this.descendVariable(block, 'VARIABLE', SCALAR_TYPE)
            };
        case 'data_insertatlist':
            return {
                kind: 'list.insert',
                list: this.descendVariable(block, 'LIST', LIST_TYPE),
                index: this.descendInput(block, 'INDEX'),
                item: this.descendInput(block, 'ITEM')
            };
        case 'data_replaceitemoflist':
            return {
                kind: 'list.replace',
                list: this.descendVariable(block, 'LIST', LIST_TYPE),
                index: this.descendInput(block, 'INDEX'),
                item: this.descendInput(block, 'ITEM')
            };
        case 'data_setvariableto':
            return {
                kind: 'var.set',
                variable: this.descendVariable(block, 'VARIABLE', SCALAR_TYPE),
                value: this.descendInput(block, 'VALUE')
            };
        case 'data_showlist':
            return {
                kind: 'list.show',
                list: this.descendVariable(block, 'LIST')
            };
        case 'data_showvariable':
            return {
                kind: 'var.show',
                variable: this.descendVariable(block, 'VARIABLE', SCALAR_TYPE)
            };

        case 'event_broadcast':
            return {
                kind: 'event.broadcast',
                broadcast: this.descendInput(block, 'BROADCAST_INPUT')
            };
        case 'event_broadcastandwait':
            return {
                kind: 'event.broadcastAndWait',
                broadcast: this.descendInput(block, 'BROADCAST_INPUT')
            };

        case 'looks_changesizeby':
            return {
                kind: 'looks.setSize',
                size: {
                    kind: 'op.add',
                    left: {
                        kind: 'looks.size'
                    },
                    right: this.descendInput(block, 'CHANGE')
                }
            };
        case 'looks_cleargraphiceffects':
            return {
                kind: 'looks.clearEffects'
            };
        case 'looks_goforwardbackwardlayers':
            if (block.fields.FORWARD_BACKWARD.value === 'forward') {
                return {
                    kind: 'looks.forwardLayers',
                    layers: this.descendInput(block, 'NUM')
                };
            }
            return {
                kind: 'looks.backwardLayers',
                layers: this.descendInput(block, 'NUM')
            };
        case 'looks_gotofrontback':
            if (block.fields.FRONT_BACK.value === 'front') {
                return {
                    kind: 'looks.goToFront'
                };
            }
            return {
                kind: 'looks.goToBack'
            };
        case 'looks_hide':
            return {
                kind: 'looks.hide'
            };
        case 'looks_setsizeto':
            return {
                kind: 'looks.setSize',
                size: this.descendInput(block, 'SIZE')
            };
        case 'looks_show':
            return {
                kind: 'looks.show'
            };
        case 'looks_switchbackdropto':
            return {
                kind: 'looks.switchBackdrop',
                backdrop: this.descendInput(block, 'BACKDROP')
            };
        case 'looks_switchcostumeto':
            return {
                kind: 'looks.switchCostume',
                costume: this.descendInput(block, 'COSTUME')
            };

        case 'motion_changexby':
            return {
                kind: 'motion.setXY',
                x: {
                    kind: 'op.add',
                    left: {
                        kind: 'motion.x'
                    },
                    right: this.descendInput(block, 'DX')
                },
                y: {
                    kind: 'motion.y'
                }
            };
        case 'motion_changeyby':
            return {
                kind: 'motion.setXY',
                x: {
                    kind: 'motion.x'
                },
                y: {
                    kind: 'op.add',
                    left: {
                        kind: 'motion.y'
                    },
                    right: this.descendInput(block, 'DY')
                }
            };
        case 'motion_gotoxy':
            return {
                kind: 'motion.setXY',
                x: this.descendInput(block, 'X'),
                y: this.descendInput(block, 'Y')
            };
        case 'motion_ifonedgebounce':
            return {
                kind: 'motion.ifOnEdgeBounce'
            };
        case 'motion_movesteps':
            return {
                kind: 'motion.step',
                steps: this.descendInput(block, 'STEPS')
            };
        case 'motion_pointindirection':
            return {
                kind: 'motion.setDirection',
                direction: this.descendInput(block, 'DIRECTION')
            };
        case 'motion_setrotationstyle':
            return {
                kind: 'motion.setRotationStyle',
                style: block.fields.STYLE.value
            };
        case 'motion_setx':
            return {
                kind: 'motion.setXY',
                x: this.descendInput(block, 'X'),
                y: {
                    kind: 'motion.y'
                }
            };
        case 'motion_sety':
            return {
                kind: 'motion.setXY',
                x: {
                    kind: 'motion.x'
                },
                y: this.descendInput(block, 'Y')
            };
        case 'motion_turnleft':
            return {
                kind: 'motion.setDirection',
                direction: {
                    kind: 'op.subtract',
                    left: {
                        kind: 'motion.direction'
                    },
                    right: this.descendInput(block, 'DEGREES')
                }
            };
        case 'motion_turnright':
            return {
                kind: 'motion.setDirection',
                direction: {
                    kind: 'op.add',
                    left: {
                        kind: 'motion.direction'
                    },
                    right: this.descendInput(block, 'DEGREES')
                }
            };

        case 'pen_clear':
            return {
                kind: 'pen.clear'
            };
        case 'pen_changePenColorParamBy':
            return {
                kind: 'pen.changeParam',
                param: this.descendInput(block, 'COLOR_PARAM'),
                value: this.descendInput(block, 'VALUE')
            };
        case 'pen_changePenHueBy':
            return {
                kind: 'pen.legacyChangeHue',
                hue: this.descendInput(block, 'HUE')
            };
        case 'pen_changePenShadeBy':
            return {
                kind: 'pen.legacyChangeShade',
                shade: this.descendInput(block, 'SHADE')
            };
        case 'pen_penDown':
            return {
                kind: 'pen.down'
            };
        case 'pen_penUp':
            return {
                kind: 'pen.up'
            };
        case 'pen_setPenColorParamTo':
            return {
                kind: 'pen.setParam',
                param: this.descendInput(block, 'COLOR_PARAM'),
                value: this.descendInput(block, 'VALUE')
            };
        case 'pen_setPenColorToColor':
            return {
                kind: 'pen.setColor',
                color: this.descendInput(block, 'COLOR')
            };
        case 'pen_setPenHueToNumber':
            return {
                kind: 'pen.legacySetHue',
                hue: this.descendInput(block, 'HUE')
            };
        case 'pen_setPenShadeToNumber':
            return {
                kind: 'pen.legacySetShade',
                shade: this.descendInput(block, 'SHADE')
            };
        case 'pen_setPenSizeTo':
            return {
                kind: 'pen.setSize',
                size: this.descendInput(block, 'SIZE')
            };
        case 'pen_changePenSizeBy':
            return {
                kind: 'pen.changeSize',
                size: this.descendInput(block, 'SIZE')
            };
        case 'pen_stamp':
            return {
                kind: 'pen.stamp'
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

            if (!this.dependedProcedures.includes(procedureCode)) {
                this.dependedProcedures.push(procedureCode);
            }

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

        case 'sensing_resettimer':
            return {
                kind: 'sensing.resetTimer'
            };

        default:
            // It might be a block that uses the compatibility layer
            if (compatBlocks.stacked.includes(block.opcode)) {
                return this.descendCompatLayer(block);
            }
            log.warn(`AST: Unknown stacked block: ${block.opcode}`, block);
            throw new Error(`AST: Unknown stacked block: ${block.opcode}`);
        }
    }

    /**
     * Descend into a stack of blocks (eg. the blocks contained within an "if" block)
     * @param {*} parentBlock The parent Scratch block that contains the stack to parse.
     * @param {*} substackName The name of the stack to descend into.
     * @returns {Node[]} List of stacked block nodes.
     */
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

    descendVariable (block, fieldName, type) {
        const variable = block.fields[fieldName];
        const id = variable.id;

        if (this.variableCache.hasOwnProperty(id)) {
            return this.variableCache[id];
        }

        const data = this.variableCache[id] = this._descendVariable(id, variable.value, type);
        this.variableCache[id] = data;
        return data;
    }

    _descendVariable (id, name, type) {
        const target = this.target;
        const stage = this.stage;

        // Look for by ID in target...
        if (target.variables.hasOwnProperty(id)) {
            return createVariableData('target', target.variables[id]);
        }

        // Look for by ID in stage...
        if (!target.isStage) {
            if (stage && stage.variables.hasOwnProperty(id)) {
                return createVariableData('stage', stage.variables[id]);
            }
        }

        // Look for by name and type in target...
        for (const varId in target.variables) {
            if (target.variables.hasOwnProperty(varId)) {
                const currVar = target.variables[varId];
                if (currVar.name === name && currVar.type === type) {
                    return createVariableData('target', currVar);
                }
            }
        }

        // Look for by name and type in stage...
        if (!target.isStage && stage) {
            for (const varId in stage.variables) {
                if (stage.variables.hasOwnProperty(varId)) {
                    const currVar = stage.variables[varId];
                    if (currVar.name === name && currVar.type === type) {
                        return createVariableData('stage', currVar);
                    }
                }
            }
        }

        // Create it locally...
        const newVariable = new Variable(id, name, type, false);
        target.variables[id] = newVariable;
        return createVariableData('target', newVariable);
    }

    descendCompatLayer (block) {
        const inputs = {};
        const fields = {};
        for (const name of Object.keys(block.inputs)) {
            inputs[name] = this.descendInput(block, name);
        }
        for (const name of Object.keys(block.fields)) {
            fields[name] = block.fields[name].value;
        }
        return {
            kind: 'compat',
            opcode: block.opcode,
            inputs,
            fields
        };
    }

    /**
     * @param {string} topBlockId The ID of the top block of the script.
     * @returns {Tree} A compiled tree.
     */
    generate (topBlockId) {
        const result = {
            stack: null,
            isProcedure: this.isProcedure,
            hasArguments: this.procedureArguments.length > 0,
            isWarp: this.isWarp,
            dependedProcedures: this.dependedProcedures
        };

        const topBlock = this.blocks.getBlock(topBlockId);
        if (!topBlock) {
            // This is an empty script.
            return result;
        }

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

        if (!entryBlock) {
            // This is an empty script.
            return result;
        }

        const stack = this.walkStack(entryBlock);

        result.stack = stack;
        return result;
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

        for (const procedureCode of generator.dependedProcedures) {
            if (this.procedures.hasOwnProperty(procedureCode)) {
                continue;
            }
            if (this.compilingProcedures.has(procedureCode)) {
                continue;
            }
            if (this.uncompiledProcedures.has(procedureCode)) {
                continue;
            }
            const definition = this.blocks.getProcedureDefinition(procedureCode);
            this.uncompiledProcedures.set(procedureCode, definition);
        }

        return result;
    }

    /**
     * @returns {AST} Syntax tree.
     */
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
                generator.setProcedureCode(procedureCode);
                if (isWarp) generator.enableWarp();
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
