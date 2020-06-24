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
        operator_not: not,
        operator_join: join,
        operator_round: round,
        operator_add: add,
        operator_subtract: subtract,
        operator_multiply: multiply,
        operator_divide: divide,
        operator_mathop: mathop,
        operator_random: random,
        operator_letter_of: letterOf,
        operator_mod: mod,
        operator_length: length,
    };
};

const equals = /** @param {InputUtil} util */ (util) => {
    const OPERAND1 = util.input('OPERAND1');
    const OPERAND2 = util.input('OPERAND2');
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

const not = /** @param {InputUtil} util */ (util) => {
    const OPERAND = util.input('OPERAND');
    return util.boolean(`!${OPERAND.asBoolean()}`);
};

const join = /** @param {InputUtil} util */ (util) => {
    const STRING1 = util.input('STRING1');
    const STRING2 = util.input('STRING2');
    return util.string(`(${STRING1.asString()} + ${STRING2.asString()})`);
};

const round = /** @param {InputUtil} util */ (util) => {
    const NUM = util.input('NUM');
    return util.number(`Math.round(${NUM.asNumber()})`);
};

const add = /** @param {InputUtil} util */ (util) => {
    const NUM1 = util.input('NUM1');
    const NUM2 = util.input('NUM2');
    return util.number(`(${NUM1.asNumber()} + ${NUM2.asNumber()})`);
};

const subtract = /** @param {InputUtil} util */ (util) => {
    const NUM1 = util.input('NUM1');
    const NUM2 = util.input('NUM2');
    return util.number(`(${NUM1.asNumber()} - ${NUM2.asNumber()})`);
};

const multiply = /** @param {InputUtil} util */ (util) => {
    const NUM1 = util.input('NUM1');
    const NUM2 = util.input('NUM2');
    return util.number(`(${NUM1.asNumber()} * ${NUM2.asNumber()})`);
};

const divide = /** @param {InputUtil} util */ (util) => {
    const NUM1 = util.input('NUM1');
    const NUM2 = util.input('NUM2');
    return util.number(`(${NUM1.asNumber()} / ${NUM2.asNumber()} || 0)`);
};

const mathop = /** @param {InputUtil} util */ (util) => {
    const OPERATOR = util.fieldValueUnsafe('OPERATOR');
    const NUM = util.input('NUM').asNumber();
    switch (OPERATOR) {
        case 'abs': return util.number(`Math.abs(${NUM})`);
        case 'floor': return util.number(`Math.floor(${NUM})`);
        case 'ceiling': return util.number(`Math.ceil(${NUM})`);
        case 'sqrt': return util.number(`(Math.sqrt(${NUM}) || 0)`);
        // TODO: consider rounding as Scratch 3 does
        case 'sin': return util.number(`Math.sin((Math.PI * ${NUM}) / 180)`);
        case 'cos': return util.number(`Math.cos((Math.PI * ${NUM}) / 180)`);
        case 'tan': return util.noop(); // TODO
        case 'asin': return util.number(`((Math.asin(${NUM}) * 180) / Math.PI)`);
        case 'acos': return util.number(`((Math.acos(${NUM}) * 180) / Math.PI)`);
        case 'atan': return util.number(`((Math.atan(${NUM}) * 180) / Math.PI)`);
        case 'ln': return util.number(`Math.log(${NUM})`);
        case 'log': return util.number(`(Math.log(${NUM}) / Math.LN10)`);
        case 'e ^': return util.number(`Math.exp(${NUM})`);
        case '10 ^': return util.number(`Math.pow(10, ${NUM})`);
    }
    return util.number('0');
};

const random = /** @param {InputUtil} util */ (util) => {
    const FROM = util.input('FROM');
    const TO = util.input('TO');
    // lack of type casts intentional, as random needs to see whether decimals are necessary
    return util.number(`runtime.ext_scratch3_operators._random(${FROM}, ${TO})`);
};

const letterOf = /** @param {InputUtil} util */ (util) => {
    const STRING = util.input('STRING');
    const LETTER = util.input('LETTER');
    return util.string(`((${STRING.asString()})[(${LETTER.asNumber()} | 0) - 1] || "")`);
};

const mod = /** @param {InputUtil} util */ (util) => {
    const NUM1 = util.input('NUM1');
    const NUM2 = util.input('NUM2');
    return util.number(`mod(${NUM1.asNumber()}, ${NUM2.asNumber})`);
};

const length = /** @param {InputUtil} util */ (util) => {
    const STRING = util.input('STRING');
    return util.number(`${STRING.asString()}.length`);
};
