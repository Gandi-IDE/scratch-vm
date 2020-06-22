const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        motion_gotoxy: goToXY,
        motion_pointindirection: pointInDirection,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {

    };
};

const goToXY = /** @param {StatementUtil} util */ (util) => {
    const X = util.input('X');
    const Y = util.input('Y');
    util.writeLn(`target.setXY(${X.asNumber()}, ${Y.asNumber()});`);
};

const pointInDirection = /** @param {StatementUtil} util */ (util) => {
    const DIRECTION = util.input('DIRECTION');
    util.writeLn(`target.setDirection(${DIRECTION.asNumber()});`);
};
