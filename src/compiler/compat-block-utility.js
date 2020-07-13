const BlockUtility = require('../engine/block-utility');

class CompatibilityLayerBlockUtility extends BlockUtility {
    constructor() {
        super(null, null);
    }

    startBranch() {
        throw new Error('startBranch is not supported on this BlockUtility');
    }
}

module.exports = CompatibilityLayerBlockUtility;
