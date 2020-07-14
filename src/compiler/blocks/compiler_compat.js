const { BlockUtil, InputUtil, StatementUtil } = require('../compiler-util');
const CompiledInput = require('../input');

const statements = [
    'control_get_counter',
    'control_incr_counter',
    'control_clear_counter',
    'motion_glideto',
    'motion_glidesecstoxy',
    'motion_goto',
    'sound_play',
    'sound_playuntildone',
    'sound_stopallsounds',
    'sound_seteffectto',
    'sound_changeeffectby',
    'sound_cleareffects',
    'sound_setvolumeto',
    'sensing_askandwait',
    'sound_seteffectto',
    'sound_changeeffectby',
    'sound_changevolumeby',
    'looks_nextcostume',
    'looks_nextbackdrop',
    'looks_say',
    'looks_sayforsecs',
    'looks_think',
    'looks_changeeffectby',
    'looks_seteffectto',
    'looks_thinkforsecs',
    'sensing_setdragmode',
    'motion_pointtowards',
];

const inputs = [
    'sound_volume',
    'sensing_of',
    'sensing_distanceto',
    'sensing_current',
    'sensing_dayssince2000',
    'sensing_loudness',
    'sensing_loud',
    'sensing_answer',
];

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    /** @type {Object.<string, (util: StatementUtil) => void>} */
    const result = {};
    for (const statement of statements) {
        result[statement] = statementCompat;
    }
    return result;
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    /** @type {Object.<string, (util: InputUtil) => CompiledInput>} */
    const result = {};
    for (const input of inputs) {
        result[input] = inputCompat;
    }
    return result;
};

/**
 * @param {BlockUtil} util
 */
const generateCompatCall = (util) => {
    const opcode = util.opcode;
    const inputNames = util.allInputs();
    const fieldNames = util.allFields();

    let result = `/* ${opcode} */ yield* executeInCompatibilityLayer({`;
    for (const inputName of inputNames) {
        const compiledInput = util.input(inputName);
        result += `"${util.safe(inputName)}":${compiledInput},`;
    }
    for (const fieldName of fieldNames) {
        const fieldValue = util.fieldValueUnsafe(fieldName);
        result += `"${util.safe(fieldName)}":"${util.safe(fieldValue)}",`;
    }
    result += `}, runtime.getOpcodeFunction("${util.safe(opcode)}"))`;

    return result;
};

const statementCompat = /** @param {StatementUtil} util */ (util) => {
    util.writeLn(generateCompatCall(util) + ';');
};

const inputCompat = /** @param {InputUtil} util */ (util) => {
    return util.unknown('(' + generateCompatCall(util) + ')');
};
