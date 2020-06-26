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
        data_deleteoflist: deleteOfList,
        data_insertatlist: insertAtList,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        data_variable: getVariable,
        data_lengthoflist: lengthOfList,
        data_itemoflist: itemOfList,
        data_listcontainsitem: listContainsItem,
    };
};

const readVariableField = /** @param {BlockUtil} util */ (util) => {
    const { id, value: name } = util.field('VARIABLE');
    return { id, name };
};

/**
 * Find the runtime reference for a variable.
 * @param {BlockUtil} util
 * @param {string} id
 * @param {string} name
 * @param {string} type
 */
const findVariable = (util, id, name, type) => {
    const target = util.target;
    // Search for it by ID
    if (target.variables.hasOwnProperty(id)) {
        return `target.variables["${util.safe(id)}"]`;
    }
    if (target.runtime && !target.isStage) {
        const stage = target.runtime.getTargetForStage();
        if (stage && stage.variables.hasOwnProperty(id)) {
            return `stage.variables["${util.safe(id)}"]`;
        }
    }
    // Search for it by name and type
    for (const varId in target.variables) {
        if (target.variables.hasOwnProperty(varId)) {
            const currVar = target.variables[varId];
            if (currVar.name === name && currVar.type === type) {
                return `target.variables["${util.safe(varId)}"]`;
            }
        }
    }
    if (target.runtime && !target.isStage) {
        const stage = target.runtime.getTargetForStage();
        if (stage) {
            for (const varId in stage.variables) {
                if (stage.variables.hasOwnProperty(varId)) {
                    const currVar = stage.variables[varId];
                    if (currVar.name === name && currVar.type === type) {
                        return currVar;
                    }
                }
            }
        }
    }
    // Should never happen.
    throw new Error('cannot find variable: ' + id + ' (' + name + ')');
};

const variableReference = /** @param {BlockUtil} util */ (util) => {
    const variable = readVariableField(util);
    util.target.lookupOrCreateVariable(variable.id, variable.name);
    return findVariable(util, variable.id, variable.name, '');
};

const readListField = /** @param {BlockUtil} util */ (util) => {
    const { id, value: name } = util.field('LIST');
    return { id, name };
};

const listReference = /** @param {BlockUtil} util */ (util) => {
    const list = readListField(util);
    util.target.lookupOrCreateList(list.id, list.name);
    return findVariable(util, list.id, list.name, 'list');
};

const getVariable = /** @param {InputUtil} util */ (util) => {
    const variable = variableReference(util);
    return util.unknown(`${variable}.value`);
};

const setVariable = /** @param {StatementUtil} util */ (util) => {
    const VALUE = util.input('VALUE');
    const variable = variableReference(util);
    util.writeLn(`${variable}.value = ${VALUE};`);
    // TODO: cloud variables
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

const deleteOfList = /** @param {StatementUtil} util */ (util) => {
    const LIST = listReference(util);
    // do not cast INDEX because of some special string values
    const INDEX = util.input('INDEX');
    util.writeLn(`listDelete(${LIST}, ${INDEX});`);
};

const addToList = /** @param {StatementUtil} util */ (util) => {
    const LIST = listReference(util);
    const ITEM = util.input('ITEM');
    util.writeLn(`${LIST}.value.push(${ITEM});`);
    util.writeLn(`${LIST}._monitorUpToDate = false;`);
};

const itemOfList = /** @param {InputUtil} util */ (util) => {
    const LIST = listReference(util);
    const INDEX = util.input('INDEX');
    return util.unknown(`listGet(${LIST}, ${INDEX})`);
};

const replaceItemOfList = /** @param {StatementUtil} util */ (util) => {
    const LIST = listReference(util);
    const INDEX = util.input('INDEX');
    const ITEM = util.input('ITEM');
    util.writeLn(`listReplace(${LIST}, ${INDEX}, ${ITEM});`);
};

const insertAtList = /** @param {StatementUtil} util */ (util) => {
    const LIST = listReference(util);
    const INDEX = util.input('INDEX');
    const ITEM = util.input('ITEM');
    util.writeLn(`listInsert(${LIST}, ${INDEX}, ${ITEM});`);
};

const listContainsItem = /** @param {InputUtil} util */ (util) => {
    const LIST = listReference(util);
    const ITEM = util.input('ITEM');
    return util.boolean(`listContains(${LIST}, ${ITEM})`);
};
