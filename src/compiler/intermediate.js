/**
 * Copyright (C) 2021 Thomas Weber
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License version 3
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * @fileoverview Common intermediates shared amongst parts of the compiler.
 */

/**
 * An IntermediateScript describes a single script.
 * Scripts do not necessarily have hats.
 */
class IntermediateScript {
    constructor () {
        /**
         * The ID of the top block of this script.
         * @type {string}
         */
        this.topBlockId = null;

        /**
         * List of nodes that make up this script.
         * @type {Array|null}
         */
        this.stack = null;

        /**
         * Whether this script is a procedure.
         * @type {boolean}
         */
        this.isProcedure = false;

        /**
         * The name of this procedure, if any.
         * @type {string}
         */
        this.procedureCode = '';

        /**
         * List of names of arguments accepted by this function, if it is a procedure.
         * @type {string[]}
         */
        this.arguments = [];

        /**
         * Whether this script should be run in warp mode.
         * @type {boolean}
         */
        this.isWarp = false;

        /**
         * Whether this script can `yield`
         * If false, this script will be compiled as a regular JavaScript function (function)
         * If true, this script will be compiled as a generator function (function*)
         * @type {boolean}
         */
        this.yields = true;

        /**
         * Whether this script should use the "warp timer"
         * @type {boolean}
         */
        this.warpTimer = false;

        /**
         * List of procedure IDs that this script needs.
         * @readonly
         */
        this.dependedProcedures = [];

        /**
         * Cached result of compiling this script.
         * @type {Function|null}
         */
        this.cachedCompileResult = null;
    }
}

/**
 * An IntermediateRepresentation contains scripts.
 */
class IntermediateRepresentation {
    constructor () {
        /**
         * The entry point of this IR.
         * @type {IntermediateScript}
         */
        this.entry = null;

        /**
         * Maps procedure IDs to their intermediate script.
         * @type {Object.<string, IntermediateScript>}
         */
        this.procedures = {};
    }
}

module.exports = {
    IntermediateScript,
    IntermediateRepresentation
};
