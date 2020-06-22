const { InputUtil, StatementUtil, BlockUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        data_setvariableto: setVariable,
        data_changevariableby: changeVariable,
        data_hidevariable: hideVariable,
        data_showvariable: showVariable,
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

const readVariableField = /** @param {BlockUtil} util */ (util) => {
    const { id, value: name } = util.field('VARIABLE');
    return { id, name };
};

const variableReference = /** @param {BlockUtil} util */ (util) => {
    const variable = readVariableField(util);
    // create the variable if it does not exist
    util.target.lookupOrCreateVariable(variable.id, variable.name);
    if (util.target.variables.hasOwnProperty(variable.id)) {
        return `target.variables["${util.safe(variable.id)}"]`;
    }
    if (util.target.runtime && !util.target.isStage) {
        const stage = util.target.runtime.getTargetForStage();
        if (stage && stage.variables.hasOwnProperty(variable.id)) {
            return `stage.variables["${util.safe(variable.id)}"]`;
        }
    }
    // this shouldn't happen
    throw new Error('cannot find variable');
};

const getVariable = /** @param {InputUtil} util */ (util) => {
    const variable = variableReference(util);
    return util.unknown(`${variable}.value`);
};

const setVariable = /** @param {StatementUtil} util */ (util) => {
    const VALUE = util.input('VALUE');
    const variable = variableReference(util);
    // TODO: cloud variables
    util.writeLn(`${variable}.value = ${VALUE}`);
};

const changeVariable = /** @param {StatementUtil} util */ (util) => {
    const VALUE = util.input('VALUE');
    const variable = variableReference(util);
    util.writeLn(`${variable}.value = ${variable}.value + ${VALUE.asNumber()}`);
    // TODO: cloud variables
};

const changeMonitorVisibility = /** @param {StatementUtil} util */ (util, visible) => {
    const variable = readVariableField(util);
    util.writeLn(`target.runtime.monitorBlocks.changeBlock({ id: "${util.safe(variable.id)}", element: "checkbox", value: ${visible} }, target.runtime);`)
};

const hideVariable = /** @param {StatementUtil} util */ (util) => {
    changeMonitorVisibility(util, false);
};

const showVariable = /** @param {StatementUtil} util */ (util) => {
    changeMonitorVisibility(util, true);
};
