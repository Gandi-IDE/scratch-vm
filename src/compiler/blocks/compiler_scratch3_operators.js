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
        operator_equals: equals,
        operator_gt: greaterThan,
        operator_lt: lessThan,
        operator_and: and,
        operator_or: or,
        operator_join: join,
    };
};

const equals = /** @param {InputUtil} util */ (util) => {
    const OPERAND1 = util.input('OPERAND1');
    const OPERAND2 = util.input('OPERAND2');
    // TODO: actual equality and things that aren't numbers
    return util.boolean(`(compare(${OPERAND1}, ${OPERAND2}) === 0)`);
};

const greaterThan = /** @param {InputUtil} util */ (util) => {
    const OPERAND1 = util.input('OPERAND1');
    const OPERAND2 = util.input('OPERAND2');
    return util.boolean(`(compare(${OPERAND1}, ${OPERAND2}) > 0)`);
};

const lessThan = /** @param {InputUtil} util */ (util) => {
    const OPERAND1 = util.input('OPERAND1');
    const OPERAND2 = util.input('OPERAND2');
    return util.boolean(`(compare(${OPERAND1}, ${OPERAND2}) < 0)`);
};

const and = /** @param {InputUtil} util */ (util) => {
    const OPERAND1 = util.input('OPERAND1');
    const OPERAND2 = util.input('OPERAND2');
    // If OPERAND2 has side effects, JS shortcircuiting may effect the behavior of this block.
    return util.boolean(`(${OPERAND1.asBoolean()} && ${OPERAND2.asBoolean()})`);
};

const or = /** @param {InputUtil} util */ (util) => {
    const OPERAND1 = util.input('OPERAND1');
    const OPERAND2 = util.input('OPERAND2');
    // If OPERAND2 has side effects, JS shortcircuiting may effect the behavior of this block.
    return util.boolean(`(${OPERAND1.asBoolean()} || ${OPERAND2.asBoolean()})`);
};

const join = /** @param {InputUtil} util */ (util) => {
    const STRING1 = util.input('STRING1');
    const STRING2 = util.input('STRING2');
    return util.string(`(${STRING1.asString()} + ${STRING2.asString()})`);
};
