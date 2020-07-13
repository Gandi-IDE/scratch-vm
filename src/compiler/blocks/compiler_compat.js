const { BlockUtil, InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @typedef {Object} CompatInfo
 * @property {string} extension
 */

/**
 * @type {Object.<string, CompatInfo>}
 */
const statements = {
    sound_play: {
        extension: 'scratch3_sound',
    },
};

const inputs = {
    sound_volume: {
        extension: 'scratch3_sound',
    },
};

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    /** @type {Object.<string, (util: StatementUtil) => void>} */
    const result = {};
    for (const statement of Object.keys(statements)) {
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
    for (const input of Object.keys(inputs)) {
        result[input] = inputCompat;
    }
    return result;
};

/**
 * @param {BlockUtil} util
 * @param {CompatInfo} data
 */
const generateCompatCall = (util, data) => {
    const opcode = util.opcode;
    const inputNames = util.allInputs();
    const extensionReference = `runtime.ext_${data.extension}`;

    let result = 'yield* executeInCompatibilityLayer({';
    for (const inputName of inputNames) {
        const compiledInput = util.input(inputName);
        result += `"${util.safe(inputName)}": ${compiledInput},`;
    }
    result += '}, ';
    result += `${extensionReference}.getPrimitives()["${util.safe(opcode)}"], `; // TODO: statically compile, support extensions, etc.
    result += `${extensionReference}`;
    result += `)`; // no semicolon here: that breaks inputs

    return result;
};

const statementCompat = /** @param {StatementUtil} util */ (util) => {
    util.writeLn(generateCompatCall(util, statements[util.opcode]) + ';');
};

const inputCompat = /** @param {InputUtil} util */ (util) => {
    return util.unknown(generateCompatCall(util, inputs[util.opcode]));
};
