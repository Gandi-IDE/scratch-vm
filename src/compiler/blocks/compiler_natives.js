const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');
const Cast = require('../../util/cast');

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
        colour_picker: colour,
    };
};

const number = /** @param {InputUtil} util */ (util) => {
    const NUM = util.fieldValueUnsafe('NUM') + '';
    const number = +NUM;
    // if the parsed number's stringified form differs from the input text, or if the number is not actually a number, just treat it like a string.
    if (number.toString() !== NUM || Number.isNaN(number)) {
        return util.fieldString('NUM');
    }
    return util.number('' + number);
};

const text = /** @param {InputUtil} util */ (util) => {
    const TEXT = util.fieldValueUnsafe('TEXT');
    // Attempt to convert numbers stored as text to actual numbers for performance.
    const textAsNumber = +TEXT;
    if (!Number.isNaN(textAsNumber) && !Cast.isWhiteSpace(TEXT)) {
        // To make sure nothing breaks, numbers that:
        //  - do not have the same stringified form as the original text
        //    (this would break "letter 4 of 50.00")
        //  - are used by the name of a costume
        //    (as set costume works differently when given numbers instead of strings)
        // are not converted.
        // TODO: might be causing some issues for stage backdrops
        if (textAsNumber.toString() === TEXT && util.target.getCostumeIndexByName(TEXT) === -1) {
            return util.number(TEXT);
        }
    }
    return util.string(`"${util.safe('' + TEXT)}"`);
};

const colour = /** @param {InputUtil} util */ (util) => {
    const COLOUR = util.fieldValueUnsafe('COLOUR');
    const hex = COLOUR.substr(1);
    if (/^[0-9a-f]{6,8}$/.test(hex)) {
        return util.number('0x' + hex);
    }
    return util.fieldString('COLOUR');
};
