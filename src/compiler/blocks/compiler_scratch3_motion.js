const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        motion_movesteps: moveSteps,
        motion_turnright: turnRight,
        motion_turnleft: turnLeft,
        motion_ifonedgebounce: ifOnEdgeBounce,
        motion_gotoxy: goToXY,
        motion_pointindirection: pointInDirection,
        motion_setx: setX,
        motion_changexby: changeX,
        motion_sety: setY,
        motion_changeyby: changeY,
        motion_setrotationstyle: setRotationStyle,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        motion_xposition: getX,
        motion_yposition: getY,
    };
};

const moveSteps = /** @param {StatementUtil} util */ (util) => {
    const STEPS = util.input('STEPS');
    util.writeLn(`runtime.ext_scratch3_motion._moveSteps(${STEPS.asNumber()}, target);`);
};

const turnRight = /** @param {StatementUtil} util */ (util) => {
    const DEGREES = util.input('DEGREES');
    util.writeLn(`target.setDirection(target.direction + ${DEGREES.asNumber()});`);
};

const turnLeft = /** @param {StatementUtil} util */ (util) => {
    const DEGREES = util.input('DEGREES');
    util.writeLn(`target.setDirection(target.direction - ${DEGREES.asNumber()});`);
};

const ifOnEdgeBounce = /** @param {StatementUtil} util */ (util) => {
    util.writeLn('runtime.ext_scratch3_motion._ifOnEdgeBounce(target);');
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

const getX = /** @param {InputUtil} util */ (util) => {
    // TODO: limitPrecision?
    return util.number('target.x');
};

const getY = /** @param {InputUtil} util */ (util) => {
    // TODO: limitPrecision?
    return util.number('target.y');
};

const setX = /** @param {StatementUtil} util */ (util) => {
    const X = util.input('X');
    util.writeLn(`target.setXY(${X.asNumber()}, target.y);`);
};

const changeX = /** @param {StatementUtil} util */ (util) => {
    const DX = util.input('DX');
    util.writeLn(`target.setXY(target.x + ${DX.asNumber()}, target.y);`);
};

const setY = /** @param {StatementUtil} util */ (util) => {
    const Y = util.input('Y');
    util.writeLn(`target.setXY(target.x, ${Y.asNumber()});`);
};

const changeY = /** @param {StatementUtil} util */ (util) => {
    const DY = util.input('DY');
    util.writeLn(`target.setXY(target.x, target.y + ${DY.asNumber()});`);
};

const setRotationStyle = /** @param {StatementUtil} util */ (util) => {
    const STYLE = util.fieldValueUnsafe('STYLE');
    util.writeLn(`target.setRotationStyle("${util.safe(STYLE)}");`);
};
