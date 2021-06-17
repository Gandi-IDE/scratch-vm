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

class VariablePool {
    /**
     * @param {string} prefix The prefix at the start of the variable name.
     */
    constructor (prefix) {
        if (prefix.trim().length === 0) {
            throw new Error('prefix cannot be empty');
        }
        this.prefix = prefix;
        /**
         * @private
         */
        this.count = 0;
    }

    next () {
        return `${this.prefix}${this.count++}`;
    }
}

module.exports = VariablePool;
