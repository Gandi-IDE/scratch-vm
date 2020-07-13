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
        sound_sounds_menu: soundsMenu,
    };
};

const soundsMenu = /** @param {InputUtil} util */ (util) => {
    return util.fieldString('SOUND_MENU');
};
