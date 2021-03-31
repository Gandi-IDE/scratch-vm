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

/**
 * Disable the toString() method on an object by making it throw when called.
 * This is useful if you want to make sure that you can't accidentally stringify a value that shouldn't be stringified.
 * @param {*} obj Object to disable the toString() method on
 */
const disableToString = obj => {
    obj.toString = () => {
        throw new Error(`toString unexpectedly called on ${obj.name || 'object'}`);
    };
};

module.exports = {
    disableToString
};
