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
        math_angle: number,
        math_number: number,
        math_integer: number,
        math_positive_number: number,
        math_whole_number: number,
        text: text,
    };
};

const number = /** @param {InputUtil} util */ (util) => {
    const NUM = util.fieldUnsafe('NUM');
    const number = Number(NUM);
    return util.number(number);
};

const text = /** @param {InputUtil} util */ (util) => {
    const TEXT = util.fieldUnsafe('TEXT');
    return util.string(`"${util.safe(TEXT)}"`);
};
