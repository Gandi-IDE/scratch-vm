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

/* eslint-disable no-eval */

/**
 * @returns {boolean} true if the nullish coalescing operator (x ?? y) is supported.
 * See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing_operator
 */
const supportsNullishCoalescing = () => {
    try {
        // eslint-disable-next-line no-unused-vars
        const fn = new Function('undefined ?? 3');
        // if function construction succeeds, the browser understood the syntax.
        return true;
    } catch (e) {
        return false;
    }
};

module.exports = {
    supportsNullishCoalescing: supportsNullishCoalescing()
};
