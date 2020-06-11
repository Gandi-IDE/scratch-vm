const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {

    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        data_variable: getVariable,
    };
};

const getVariable = /** @param {InputUtil} util */ (util) => {
    // TODO: this is unsafe.
    // TODO: lookupOrCreateVariable has overhead, use target.variables directly instead if possible
    return util.number(`target.lookupOrCreateVariable("${util.block.fields.VARIABLE.id}", "${util.block.fields.VARIABLE.value}")`);
};
