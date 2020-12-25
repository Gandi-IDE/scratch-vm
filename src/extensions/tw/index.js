const formatMessage = require('format-message');
const BlockType = require('../../extension-support/block-type');
const ArgumentType = require('../../extension-support/argument-type');
const Cast = require('../../util/cast');

/**
 * Class for TurboWarp blocks
 * @constructor
 */
class TurboWarpBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;
    }

    /**
     * @returns {object} metadata for this extension and its blocks.
     */
    getInfo () {
        return {
            id: 'tw',
            name: 'TurboWarp',
            color1: '#ff4c4c',
            color2: '#e64444',
            blocks: [
                {
                    opcode: 'getLastKeyPressed',
                    text: formatMessage({
                        id: 'tw.blocks.lastKeyPressed',
                        default: 'last key pressed',
                        description: 'get the last key that was pressed'
                    }),
                    blockType: BlockType.REPORTER
                },
                {
                    opcode: 'getButtonIsDown',
                    text: formatMessage({
                        id: 'tw.blocks.buttonIsDown',
                        default: '[MOUSE_BUTTON] mouse button down?'
                    }),
                    blockType: BlockType.BOOLEAN,
                    arguments: {
                        MOUSE_BUTTON: {
                            type: ArgumentType.NUMBER,
                            menu: 'mouseButton',
                            defaultValue: '0'
                        }
                    }
                }
            ],
            menus: {
                mouseButton: {
                    items: [
                        {
                            text: formatMessage({
                                id: 'tw.blocks.mouseButtons.left',
                                default: '(0) left',
                                description: 'left mouse button'
                            }),
                            value: '0'
                        },
                        {
                            text: formatMessage({
                                id: 'tw.blocks.mouseButtons.middle',
                                default: '(1) middle',
                                description: 'middle mouse button'
                            }),
                            value: '1'
                        },
                        {
                            text: formatMessage({
                                id: 'tw.blocks.mouseButtons.right',
                                default: '(2) right',
                                description: 'right mouse button'
                            }),
                            value: '2'
                        }
                    ],
                    acceptReporters: true
                }
            }
        };
    }

    getLastKeyPressed (args, util) {
        return util.ioQuery('keyboard', 'getLastKeyPressed');
    }

    getButtonIsDown (args, util) {
        const button = Cast.toNumber(args.MOUSE_BUTTON);
        return util.ioQuery('mouse', 'getButtonIsDown', [button]);
    }
}

module.exports = TurboWarpBlocks;
