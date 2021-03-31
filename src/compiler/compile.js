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

const IRGenerator = require('./irgen');
const JSGenerator = require('./jsgen');

const compile = thread => {
    const irGenerator = new IRGenerator(thread);
    const ir = irGenerator.generate();

    const procedures = {};
    const target = thread.target;

    const compileScript = script => {
        if (script.cachedCompileResult) {
            return script.cachedCompileResult;
        }

        const compiler = new JSGenerator(script, ir, target);
        const result = compiler.compile();
        script.cachedCompileResult = result;
        return result;
    };

    const entry = compileScript(ir.entry);

    for (const procedureCode of Object.keys(ir.procedures)) {
        const procedureData = ir.procedures[procedureCode];
        const procedureTree = compileScript(procedureData);
        procedures[procedureCode] = procedureTree;
    }

    return {
        startingFunction: entry,
        procedures
    };
};

module.exports = compile;
