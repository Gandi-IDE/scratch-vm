const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        sensing_resettimer: resetTimer,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        sensing_touchingobject: touchingObject,
        sensing_touchingobjectmenu: touchingObjectMenu,
        sensing_timer: getTimer,
    };
};

const touchingObject = /** @param {InputUtil} util */ (util) => {
    const TOUCHINGOBJECTMENU = util.input('TOUCHINGOBJECTMENU');
    return util.boolean(`target.isTouchingObject(${TOUCHINGOBJECTMENU})`);
};

const touchingObjectMenu = /** @param {InputUtil} util */ (util) => {
    return util.fieldString('TOUCHINGOBJECTMENU');
};

const resetTimer = /** @param {StatementUtil} util */ (util) => {
    util.writeLn('ioQuery(target.runtime, "clock", "resetProjectTimer");');
};

const getTimer = /** @param {InputUtil} util */ (util) => {
    return util.number('ioQuery(target.runtime, "clock", "projectTimer")');
};
