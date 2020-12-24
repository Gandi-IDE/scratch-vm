const formatMessage = require('format-message');
const BlockType = require('../../extension-support/block-type');

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
            id: 'turbowarp',
            name: 'TurboWarp',
            color1: '#ff4c4c',
            color2: '#cc3333',
            blocks: [
                {
                    opcode: 'getLastKeyPressed',
                    text: formatMessage({
                        id: 'tw.lastKeyPressed',
                        default: 'last key pressed',
                        description: 'get the last key that was pressed'
                    }),
                    blockType: BlockType.REPORTER
                }
            ]
        };
    }

    getLastKeyPressed (args, util) {
        return util.ioQuery('keyboard', 'getLastKeyPressed');
    }
}

module.exports = TurboWarpBlocks;
