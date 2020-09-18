const Cast = require('../util/cast');
const Variable = require('../engine/variable');
const log = require('../util/log');

const SCALAR_TYPE = '';
const LIST_TYPE = 'list';

const compatBlocks = require('./compat-blocks');

/**
 * @typedef Tree
 * @property {null|Array} stack The nodes that comprise this script. `null` is an empty stack.
 * @property {string} procedureCode
 * @property {boolean} isProcedure
 * @property {string[]} arguments
 * @property {boolean} isWarp
 * @property {boolean} yields
 * @property {boolean} loopStuckChecking
 * @property {Array<string>} dependedProcedures The list of procedure codes that this tree directly depends on. Does not include dependencies of dependencies, etc.
 * @property {*} cachedCompileResult
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

/**
 * Create a variable codegen object.
 * @param {'target'|'stage'} scope The scope of this variable -- which object owns it.
 * @param {import('../engine/variable.js')} varObj The Scratch Variable
 * @returns {*} A variable codegen object.
 */
const createVariableData = (scope, varObj) => ({
    scope,
    id: varObj.id,
    name: varObj.name,
    isCloud: varObj.isCloud
});

class ScriptTreeGenerator {
    constructor (thread) {
        /** @private */
        this.thread = thread;
        /** @private */
        this.target = thread.target;
        /** @private */
        this.blocks = thread.blockContainer;
        /** @private */
        this.runtime = this.target.runtime;
        /** @private */
        this.stage = this.runtime.getTargetForStage();

        /**
         * List of procedures that this script depends on.
         */
        this.dependedProcedures = [];

        /** @private */
        this.isProcedure = false;
        /** @private */
        this.procedureCode = '';
        /** @private */
        this.isWarp = false;
        /** @private */
        this.yields = true;
        /** @private */
        this.loopStuckChecking = this.target.runtime.compilerOptions.loopStuckChecking;

        /**
         * The names of the arguments accepted by this script, in order.
         * @type {string[]}
         * @private
         */
        this.procedureArguments = [];

        /**
         * Cache of variable ID to variable data object.
         * @type {Object.<string, object>}
         * @private
         */
        this.variableCache = {};
    }

    setProcedureCode (procedureCode) {
        this.procedureCode = procedureCode;
        this.isProcedure = true;
        this.yields = false;

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
     * @private
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
            const name = block.fields.VALUE.value;
            // lastIndexOf because multiple parameters with the same name will use the value of the last definition
            const index = this.procedureArguments.lastIndexOf(name);
            if (index === -1) {
                if (name.toLowerCase() === 'last key pressed') {
                    return {
                        kind: 'tw.lastKeyPressed'
                    };
                }
            }
            if (index === -1) {
                return {
                    kind: 'constant',
                    value: 0
                };
            }
            return {
                kind: 'args.stringNumber',
                index: index
            };
        }
        case 'argument_reporter_boolean': {
            // see argument_reporter_string_number above
            const name = block.fields.VALUE.value;
            const index = this.procedureArguments.lastIndexOf(name);
            if (index === -1) {
                if (name.toLowerCase() === 'is compiled?' || name.toLowerCase() === 'is turbowarp?') {
                    return {
                        kind: 'constant',
                        value: true
                    };
                }
                return {
                    kind: 'constant',
                    value: 0
                };
            }
            return {
                kind: 'args.boolean',
                index: index
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

        case 'music_menu_DRUM':
            return {
                kind: 'constant',
                value: block.fields.DRUM.value
            };
        case 'music_menu_INSTRUMENT':
            return {
                kind: 'constant',
                value: block.fields.INSTRUMENT.value
            };

        case 'note':
            return {
                kind: 'constant',
                value: block.fields.NOTE.value
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
            const operator = block.fields.OPERATOR.value.toLowerCase();
            switch (operator) {
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
                // If both numbers are the same, random is unnecessary.
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
                // If only one value is known at compile-time, we can still attempt some optimizations.
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

        case 'sensing_answer':
            return {
                kind: 'sensing.answer'
            };
        case 'sensing_coloristouchingcolor':
            return {
                kind: 'sensing.colorTouchingColor',
                target: this.descendInput(block, 'COLOR2'),
                mask: this.descendInput(block, 'COLOR')
            };
        case 'sensing_current':
            return {
                kind: 'sensing.current',
                property: block.fields.CURRENTMENU.value.toLowerCase()
            };
        case 'sensing_dayssince2000':
            return {
                kind: 'sensing.daysSince2000'
            };
        case 'sensing_distancetomenu':
            return {
                kind: 'constant',
                value: block.fields.DISTANCETOMENU.value
            };
        case 'sensing_distanceto':
            return {
                kind: 'sensing.distance',
                target: this.descendInput(block, 'DISTANCETOMENU')
            };
        case 'sensing_keyoptions':
            return {
                kind: 'constant',
                value: block.fields.KEY_OPTION.value
            };
        case 'sensing_keypressed':
            return {
                kind: 'keyboard.pressed',
                key: this.descendInput(block, 'KEY_OPTION')
            };
        case 'sensing_mousedown':
            return {
                kind: 'mouse.down'
            };
        case 'sensing_mousex':
            return {
                kind: 'mouse.x'
            };
        case 'sensing_mousey':
            return {
                kind: 'mouse.y'
            };
        case 'sensing_of_object_menu':
            return {
                kind: 'constant',
                value: block.fields.OBJECT.value
            };
        case 'sensing_of':
            return {
                kind: 'sensing.of',
                property: block.fields.PROPERTY.value,
                object: this.descendInput(block, 'OBJECT')
            };
        case 'sensing_timer':
            return {
                kind: 'timer.get'
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

        case 'text2speech_menu_languages':
            return {
                kind: 'constant',
                value: block.fields.languages.value
            };
        case 'text2speech_menu_voices':
            return {
                kind: 'constant',
                value: block.fields.voices.value
            };

        case 'translate_menu_languages':
            return {
                kind: 'constant',
                value: block.fields.languages.value
            };

        case 'videoSensing_menu_ATTRIBUTE':
            return {
                kind: 'constant',
                value: block.fields.ATTRIBUTE.value
            };
        case 'videoSensing_menu_SUBJECT':
            return {
                kind: 'constant',
                value: block.fields.SUBJECT.value
            };
        case 'videoSensing_menu_VIDEO_STATE':
            return {
                kind: 'constant',
                value: block.fields.VIDEO_STATE.value
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
     * @private
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
            this.yields = true; // todo: remove
            return {
                kind: 'control.deleteClone'
            };
        case 'control_forever':
            this.analyzeLoop();
            return {
                kind: 'control.while',
                condition: {
                    kind: 'constant',
                    value: true
                },
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_for_each':
            this.analyzeLoop();
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
            this.analyzeLoop();
            return {
                kind: 'control.repeat',
                times: this.descendInput(block, 'TIMES'),
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_repeat_until':
            this.analyzeLoop();
            return {
                kind: 'control.while',
                condition: {
                    kind: 'op.not',
                    operand: this.descendInput(block, 'CONDITION')
                },
                do: this.descendSubstack(block, 'SUBSTACK')
            };
        case 'control_stop': {
            const level = block.fields.STOP_OPTION.value;
            if (level === 'all') {
                this.yields = true; // todo: remove
                return {
                    kind: 'control.stopAll'
                };
            } else if (level === 'other scripts in sprite' || level === 'other scripts in stage') {
                return {
                    kind: 'control.stopOthers'
                };
            } else if (level === 'this script') {
                return {
                    kind: 'control.stopScript'
                };
            }
            return {
                kind: 'noop'
            };
        }
        case 'control_wait':
            this.yields = true;
            return {
                kind: 'control.wait',
                seconds: this.descendInput(block, 'DURATION')
            };
        case 'control_wait_until':
            this.yields = true;
            return {
                kind: 'control.waitUntil',
                condition: this.descendInput(block, 'CONDITION')
            };
        case 'control_while':
            this.analyzeLoop();
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
        case 'data_changevariableby': {
            const variable = this.descendVariable(block, 'VARIABLE', SCALAR_TYPE);
            return {
                kind: 'var.set',
                variable,
                value: {
                    kind: 'op.add',
                    left: {
                        kind: 'var.get',
                        variable
                    },
                    right: this.descendInput(block, 'VALUE')
                }
            };
        }
        case 'data_deletealloflist':
            return {
                kind: 'list.deleteAll',
                list: this.descendVariable(block, 'LIST', LIST_TYPE)
            };
        case 'data_deleteoflist': {
            const index = this.descendInput(block, 'INDEX');
            if (index.kind === 'constant' && index.value === 'all') {
                return {
                    kind: 'list.deleteAll',
                    list: this.descendVariable(block, 'LIST', LIST_TYPE)
                };
            }
            return {
                kind: 'list.delete',
                list: this.descendVariable(block, 'LIST', LIST_TYPE),
                index: index
            };
        }
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
            this.yields = true;
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
            // setting of yields will be handled later in the analysis phase

            const procedureCode = block.mutation.proccode;
            if (procedureCode === 'tw:debugger;') {
                return {
                    kind: 'tw.debugger'
                };
            }
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

            // Non-warp recursion yields.
            if (!this.isWarp) {
                if (procedureCode === this.procedureCode) {
                    this.yields = true;
                }
            }

            const args = [];
            for (let i = 0; i < paramIds.length; i++) {
                let value;
                // todo: move this sort of existance checking somewhere else
                if (block.inputs[paramIds[i]] && block.inputs[paramIds[i]].block) {
                    value = this.descendInput(block, paramIds[i]);
                } else {
                    value = {
                        kind: 'constant',
                        value: paramDefaults[i]
                    };
                }
                args.push(value);
            }

            return {
                kind: 'procedures.call',
                code: procedureCode,
                arguments: args
            };
        }

        case 'sensing_resettimer':
            return {
                kind: 'timer.reset'
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
     * @private
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

    /**
     * Descend into and walk the siblings of a stack.
     * @param {string} startingBlockId The ID of the first block of a stack.
     * @private
     * @returns {Node[]} List of stacked block nodes.
     */
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

    /**
     * Descend into a variable.
     * @param {*} block The block that has the variable.
     * @param {string} fieldName The name of the field that the variable is stored in.
     * @param {''|'list'} type Variable type, '' for scalar and 'list' for list.
     * @private
     * @returns {*} A parsed variable object.
     */
    descendVariable (block, fieldName, type) {
        const variable = block.fields[fieldName];
        const id = variable.id;

        if (this.variableCache.hasOwnProperty(id)) {
            return this.variableCache[id];
        }

        const data = this._descendVariable(id, variable.value, type);
        this.variableCache[id] = data;
        return data;
    }

    /**
     * @param {string} id The ID of the variable.
     * @param {string} name The name of the variable.
     * @param {''|'list'} type The variable type.
     * @private
     * @returns {*} A parsed variable object.
     */
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

        // If the sprite being compiled right now is a clone, we should also create the variable in the original sprite.
        // This is necessary because the script cache is shared between clones, and new clones would not have this variable created.
        if (!target.isOriginal) {
            // The original sprite will usually be the first item of `clones`, but it's possible that it might not be.
            const original = this.target.sprite.clones.find(t => t.isOriginal);
            if (original && !original.variables.hasOwnProperty(id)) {
                original.variables[id] = new Variable(id, name, type, false);
            }
        }

        return createVariableData('target', newVariable);
    }

    /**
     * Descend into a block that uses the compatibility layer.
     * @param {*} block The block to use the compatibility layer for.
     * @private
     * @returns {Node} The parsed node.
     */
    descendCompatLayer (block) {
        this.yields = true;
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

    analyzeLoop () {
        if (!this.isWarp || this.loopStuckChecking) {
            this.yields = true;
        }
    }

    readTopBlockComment (commentId) {
        const comment = this.target.comments[commentId];
        if (!comment) {
            // can't find the comment
            // this is safe to ignore
            return;
        }

        const text = comment.text;

        for (const line of text.split('\n')) {
            if (!/^tw\b/.test(line)) {
                continue;
            }

            const flags = line.split(' ');
            for (const flag of flags) {
                switch (flag) {
                case 'nocompile':
                    throw new Error('Script explicitly disables compilation');
                case 'stuck':
                    this.loopStuckChecking = true;
                    break;
                }
            }

            // Only the first 'tw' line is parsed.
            break;
        }
    }

    /**
     * @param {string} topBlockId The ID of the top block of the script.
     * @returns {Tree} A compiled tree.
     */
    generate (topBlockId) {
        /** @type {Tree} */
        const result = {
            stack: null,
            procedureCode: this.procedureCode,
            isProcedure: this.isProcedure,
            arguments: this.procedureArguments,
            isWarp: this.isWarp,
            dependedProcedures: this.dependedProcedures,
            yields: this.yields, // will be updated later
            loopStuckChecking: this.loopStuckChecking, // will be updated later
            cachedCompileResult: null
        };

        const topBlock = this.blocks.getBlock(topBlockId);
        if (!topBlock) {
            if (this.isProcedure) {
                // Empty procedure
                return result;
            }
            // Probably running from toolbox. This is not currently supported.
            throw new Error('Cannot find top block (running from toolbox?)');
        }

        if (topBlock.comment) {
            this.readTopBlockComment(topBlock.comment);
        }

        // If the top block is a hat, advance to its child.
        let entryBlock;
        if (this.runtime.getIsHat(topBlock.opcode) || topBlock.opcode === 'procedures_definition') {
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

        result.stack = this.walkStack(entryBlock);
        result.yields = this.yields;
        result.loopStuckChecking = this.loopStuckChecking;

        return result;
    }
}

class ASTGenerator {
    constructor (thread) {
        this.thread = thread;
        this.blocks = thread.blockContainer;

        this.proceduresToCompile = new Map();
        this.compilingProcedures = new Map();
        /** @type {Object.<string, Tree>} */
        this.procedures = {};

        this.analyzedProcedures = [];
    }

    addProcedureDependencies (dependencies) {
        for (const procedureCode of dependencies) {
            if (this.procedures.hasOwnProperty(procedureCode)) {
                continue;
            }
            if (this.compilingProcedures.has(procedureCode)) {
                continue;
            }
            if (this.proceduresToCompile.has(procedureCode)) {
                continue;
            }
            const definition = this.blocks.getProcedureDefinition(procedureCode);
            this.proceduresToCompile.set(procedureCode, definition);
        }
    }

    /**
     * @param {ScriptTreeGenerator} generator The generator to run.
     * @param {string} topBlockId The ID of the top block in the stack.
     * @returns {Tree} Tree for this script.
     */
    generateScriptTree (generator, topBlockId) {
        const result = generator.generate(topBlockId);
        this.addProcedureDependencies(result.dependedProcedures);
        return result;
    }

    /**
     * Recursively analyze a script tree and its dependencies.
     * @param {Tree} tree Root script tree.
     */
    analyzeScript (tree) {
        for (const procedureCode of tree.dependedProcedures) {
            const procedureData = this.procedures[procedureCode];

            // Analyze newly found procedures.
            if (!this.analyzedProcedures.includes(procedureCode)) {
                this.analyzedProcedures.push(procedureCode);
                this.analyzeScript(procedureData);
                // There seems to be some problems with recursive functions being analyzed incorrectly.
                // I need to look into it more, but for now it seems that less aggressively skipping unnecessary analysis fixes it.
                this.analyzedProcedures.pop();
            }

            // If a procedure used by a script may yield, the script itself may yield.
            if (procedureData.yields) {
                tree.yields = true;
            }
        }
    }

    /**
     * @returns {AST} Syntax tree.
     */
    generate () {
        const entry = this.generateScriptTree(new ScriptTreeGenerator(this.thread), this.thread.topBlock);

        // Compile any required procedures.
        // As procedures can depend on other procedures, this process may take several iterations.
        while (this.proceduresToCompile.size > 0) {
            this.compilingProcedures = this.proceduresToCompile;
            this.proceduresToCompile = new Map();

            for (const [procedureCode, definitionId] of this.compilingProcedures.entries()) {
                const definitionBlock = this.blocks.getBlock(definitionId);
                const innerDefinition = this.blocks.getBlock(definitionBlock.inputs.custom_block.block);

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

                if (this.blocks._cache.compiledProcedures[procedureCode]) {
                    const result = this.blocks._cache.compiledProcedures[procedureCode];
                    this.procedures[procedureCode] = result;
                    this.addProcedureDependencies(result.dependedProcedures);
                } else {
                    const generator = new ScriptTreeGenerator(this.thread);
                    generator.setProcedureCode(procedureCode);
                    if (isWarp) generator.enableWarp();
                    const compiledProcedure = this.generateScriptTree(generator, definitionId);
                    this.procedures[procedureCode] = compiledProcedure;
                    this.blocks._cache.compiledProcedures[procedureCode] = compiledProcedure;
                }
            }
        }

        // This will recursively analyze procedures as well.
        this.analyzeScript(entry);

        return {
            entry: entry,
            procedures: this.procedures
        };
    }
}

module.exports = ASTGenerator;
