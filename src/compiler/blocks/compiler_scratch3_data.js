const { InputUtil, StatementUtil, BlockUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        data_setvariableto: setVariable,
        data_changevariableby: changeVariable,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        data_variable: getVariable,
    };
};

const lookupOrCreateVariable = /** @param {BlockUtil} util */ (util) => {
    const { id, value: name } = util.block.fields.VARIABLE;
    // create the variable if it does not exist
    util.target.lookupOrCreateVariable(id, name);
    if (util.target.variables.hasOwnProperty(id)) {
        return `target.variables["${util.safe(id)}"]`;
    }
    if (util.target.runtime && !util.target.isStage) {
        const stage = util.target.runtime.getTargetForStage();
        if (stage && stage.variables.hasOwnProperty(id)) {
            return `stage.variables["${util.safe(id)}"]`;
        }
    }
    // this shouldn't happen
    throw new Error('cannot find variable');
};

const getVariable = /** @param {InputUtil} util */ (util) => {
    const variable = lookupOrCreateVariable(util);
    return util.unknown(`${variable}.value`);
};

const setVariable = /** @param {StatementUtil} util */ (util) => {
    const VALUE = util.input('VALUE');
    const variable = lookupOrCreateVariable(util);
    util.writeLn(`${variable}.value = ${VALUE}`);
};

const changeVariable = /** @param {StatementUtil} util */ (util) => {
    const VALUE = util.input('VALUE');
    const variable = lookupOrCreateVariable(util);
    util.writeLn(`${variable}.value = ${variable}.value + ${VALUE.asNumber()}`);
};
