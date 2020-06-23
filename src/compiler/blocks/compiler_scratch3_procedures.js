const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        procedures_call: call,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {

    };
};

const call = /** @param {StatementUtil} util */ (util) => {
    const procedureCode = util.block.mutation.proccode;
    const paramNamesIdsAndDefaults = util.target.blocks.getProcedureParamNamesIdsAndDefaults(procedureCode);
    if (paramNamesIdsAndDefaults === null) {
        return;
    }
    const [paramNames, paramIds, paramDefaults] = paramNamesIdsAndDefaults;
    const labelId = util.nextLabel();

    util.compiler.dependProcedure(procedureCode);

    util.writeLn(`call("${util.safe(procedureCode)}", ${labelId}); return;`);

    util.putLabel(labelId);

    // for (let i = 0; i < paramIds.length; i++) {
    //     if (args.hasOwnProperty(paramIds[i])) {
    //         util.pushParam(paramNames[i], args[paramIds[i]]);
    //     } else {
    //         util.pushParam(paramNames[i], paramDefaults[i]);
    //     }
    // }

};
