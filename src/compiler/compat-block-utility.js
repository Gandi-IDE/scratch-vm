/**
 * Copyright (C) 2021 Thomas Weber
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const BlockUtility = require('../engine/block-utility');

class CompatibilityLayerBlockUtility extends BlockUtility {
    // Branching operations are not supported.
    startBranch () {
        throw new Error('startBranch is not supported by this BlockUtility');
    }
    startProcedure () {
        throw new Error('startProcedure is not supported by this BlockUtility');
    }

    // Parameters are not used by compiled scripts.
    initParams () {
        throw new Error('initParams is not supported by this BlockUtility');
    }
    pushParam () {
        throw new Error('pushParam is not supported by this BlockUtility');
    }
    getParam () {
        throw new Error('getParam is not supported by this BlockUtility');
    }
}

// Export a single instance to be reused.
module.exports = new CompatibilityLayerBlockUtility();
