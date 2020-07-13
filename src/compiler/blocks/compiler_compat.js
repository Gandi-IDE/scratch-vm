const { BlockUtil, InputUtil, StatementUtil, CompiledInput } = require('../compiler');

const statements = [
    'motion_glideto',
    'sound_play',
    'sound_playuntildone',
    'sensing_askandwait',
];

const inputs = [
    'sound_volume',
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

    let result = 'yield* executeInCompatibilityLayer({';
    for (const inputName of inputNames) {
        const compiledInput = util.input(inputName);
        result += `"${util.safe(inputName)}":${compiledInput},`;
    }
    result += '}, ';
    result += `runtime.getOpcodeFunction("${util.safe(opcode)}")`;
    result += `)`; // no semicolon here: that would break inputs

    return result;
};

const statementCompat = /** @param {StatementUtil} util */ (util) => {
    util.writeLn(generateCompatCall(util) + ';');
};

const inputCompat = /** @param {InputUtil} util */ (util) => {
    return util.unknown(generateCompatCall(util));
};
