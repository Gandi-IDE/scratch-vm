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
        data_hidelist: hideList,
        data_showlist: showList,
        data_deletealloflist: deleteAllOfList,
        data_addtolist: addToList,
        data_replaceitemoflist: replaceItemOfList,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        data_variable: getVariable,
        data_lengthoflist: lengthOfList,
        data_itemoflist: getItemOfList,
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

const readListField = /** @param {BlockUtil} util */ (util) => {
    const { id, value: name } = util.field('LIST');
    return { id, name };
};

const listReference = /** @param {BlockUtil} util */ (util) => {
    const list = readListField(util);
    // create the list if it does not exist
    util.target.lookupOrCreateList(list.id, list.name);
    if (util.target.variables.hasOwnProperty(list.id)) {
        return `target.variables["${util.safe(list.id)}"]`;
    }
    if (util.target.runtime && !util.target.isStage) {
        const stage = util.target.runtime.getTargetForStage();
        if (stage && stage.variables.hasOwnProperty(list.id)) {
            return `stage.variables["${util.safe(list.id)}"]`;
        }
    }
    // this shouldn't happen
    throw new Error('cannot find list');
};

const getVariable = /** @param {InputUtil} util */ (util) => {
    const variable = variableReference(util);
    return util.unknown(`${variable}.value`);
};

const setVariable = /** @param {StatementUtil} util */ (util) => {
    const VALUE = util.input('VALUE');
    const variable = variableReference(util);
    // TODO: cloud variables
    util.writeLn(`${variable}.value = ${VALUE};`);
};

const changeVariable = /** @param {StatementUtil} util */ (util) => {
    const VALUE = util.input('VALUE');
    const variable = variableReference(util);
    util.writeLn(`${variable}.value = toNumber(${variable}.value) + ${VALUE.asNumber()};`);
    // TODO: cloud variables
};

const changeMonitorVisibility = /** @param {StatementUtil} util */ (util, variable, visible) => {
    util.writeLn(`target.runtime.monitorBlocks.changeBlock({ id: "${util.safe(variable.id)}", element: "checkbox", value: ${visible} }, target.runtime);`)
};

const hideVariable = /** @param {StatementUtil} util */ (util) => {
    changeMonitorVisibility(util, readVariableField(util), false);
};

const showVariable = /** @param {StatementUtil} util */ (util) => {
    changeMonitorVisibility(util, readVariableField(util), true);
};

const hideList = /** @param {StatementUtil} util */ (util) => {
    changeMonitorVisibility(util, readListField(util), false);
};

const showList = /** @param {StatementUtil} util */ (util) => {
    changeMonitorVisibility(util, readListField(util), true);
};

const lengthOfList = /** @param {InputUtil} util */ (util) => {
    const LIST = listReference(util);
    return util.number(`${LIST}.value.length`);
};

const deleteAllOfList = /** @param {StatementUtil} util */ (util) => {
    const LIST = listReference(util);
    util.writeLn(`${LIST}.value = [];`);
};

const addToList = /** @param {StatementUtil} util */ (util) => {
    const LIST = listReference(util);
    const ITEM = util.input('ITEM');
    // TODO: list length limit?
    util.writeLn(`${LIST}.value.push(${ITEM});`);
    util.writeLn(`${LIST}._monitorUpToDate = false;`);
};

const getItemOfList = /** @param {InputUtil} util */ (util) => {
    const LIST = listReference(util);
    const INDEX = util.input('INDEX');
    return util.unknown(`getListItem(${LIST}, ${INDEX})`);
};

const replaceItemOfList = /** @param {StatementUtil} util */ (util) => {
    const LIST = listReference(util);
    const INDEX = util.input('INDEX');
    const ITEM = util.input('ITEM');
    util.writeLn(`replaceItemOfList(${LIST}, ${INDEX}, ${ITEM});`);
};
