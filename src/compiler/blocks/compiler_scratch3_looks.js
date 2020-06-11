const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        looks_changeeffectby: changeEffect,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        
    };
};

const changeEffect = (util) => {
    const CHANGE = util.getInput('CHANGE');
    util.writeLn(`target.setEffect("color", target.effects.color + ${CHANGE});`);
};
