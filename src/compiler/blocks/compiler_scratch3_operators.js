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
        operator_equals: equals
    };
};

const equals = /** @param {InputUtil} util */ (util) => {
    const OPERAND1 = util.input('OPERAND1');
    const OPERAND2 = util.input('OPERAND2');
    // TODO: actual equality and things that aren't numbers
    return util.boolean(`(${OPERAND1.asNumber()} === ${OPERAND2.asNumber()})`);
};
