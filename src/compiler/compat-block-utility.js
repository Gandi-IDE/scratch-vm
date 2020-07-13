const BlockUtility = require('../engine/block-utility');

class CompatibilityLayerBlockUtility extends BlockUtility {
    constructor() {
        super(null, null);
    }

    startBranch() {
        throw new Error('startBranch is not supported by this BlockUtility');
    }

    startProcedure() {
        throw new Error('startProcedure is not supported by this BlockUtility');
    }
}

module.exports = CompatibilityLayerBlockUtility;
