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
        argument_reporter_string_number: getStringArgument,
        argument_reporter_boolean: getBooleanArgument,
    };
};

const call = /** @param {StatementUtil} util */ (util) => {
    const procedureCode = util.block.mutation.proccode;

    // debugger block
    if (procedureCode === 'debugger;') {
        util.writeLn('debugger;');
        return;
    }

    const paramNamesIdsAndDefaults = util.target.blocks.getProcedureParamNamesIdsAndDefaults(procedureCode);
    if (paramNamesIdsAndDefaults === null) {
        return;
    }

    const [paramNames, paramIds, paramDefaults] = paramNamesIdsAndDefaults;
    const labelId = util.nextLabel();

    util.compiler.dependProcedure(procedureCode);

    util.write(`call("${util.safe(procedureCode)}", {`);

    for (let i = 0; i < paramIds.length; i++) {
        let value;
        if (util.hasInput(paramIds[i])) {
            value = util.input(paramIds[i]);
        } else {
            const defaultValue = paramDefaults[i];
            if (typeof defaultValue === 'boolean' || typeof defaultValue === 'number') {
                value = defaultValue;
            } else {
                value = `"${util.safe(defaultValue)}"`;
            }
        }
        util.write(`"${util.safe(paramNames[i])}": ${value},`);
    }

    util.writeLn(`}, ${labelId}); return;`);
    util.putLabel(labelId);
};

const getStringArgument = /** @param {InputUtil} util */ (util) => {
    const VALUE = util.fieldValueUnsafe('VALUE');
    return util.unknown(`thread.call.args["${util.safe(VALUE)}"]`);
};

const getBooleanArgument = /** @param {InputUtil} util */ (util) => {
    const VALUE = util.fieldValueUnsafe('VALUE');
    return util.boolean(`toBoolean(thread.call.args["${util.safe(VALUE)}"])`);
};
