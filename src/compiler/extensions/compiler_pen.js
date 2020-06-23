const {InputUtil, StatementUtil, CompiledInput} = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        pen_clear: clear,
        pen_setPenColorToColor: setPenColor,
        pen_penDown: penDown,
        pen_penUp: penUp,
        pen_setPenSizeTo: setPenSize,
        pen_changePenSizeBy: changePenSize,
        // Legacy blocks
        pen_changePenHueBy: changePenHueBy,
        pen_setPenShadeToNumber: setPenShade,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {

    };
};

const clear = /** @param {StatementUtil} util */ (util) => {
    util.writeLn(`runtime.ext_pen.clear();`);
};

const setPenColor = /** @param {StatementUtil} util */ (util) => {
    const COLOR = util.input('COLOR');
    util.writeLn(`runtime.ext_pen._setPenColorToColor(${COLOR}, target);`);
};

const penDown = /** @param {StatementUtil} util */ (util) => {
    util.writeLn('runtime.ext_pen._penDown(target);');
};

const penUp = /** @param {StatementUtil} util */ (util) => {
    util.writeLn('runtime.ext_pen._penUp(target);');
};

const setPenSize = /** @param {StatementUtil} util */ (util) => {
    const SIZE = util.input('SIZE');
    util.writeLn(`runtime.ext_pen._getPenState(target).penAttributes.diameter = runtime.ext_pen._clampPenSize(${SIZE.asNumber()});`);
};

const changePenSize = /** @param {StatementUtil} util */ (util) => {
    const SIZE = util.input('SIZE');
    util.writeLn(`runtime.ext_pen._getPenState(target).penAttributes.diameter += runtime.ext_pen._clampPenSize(${SIZE.asNumber()});`);
};

const changePenHueBy = /** @param {StatementUtil} util */ (util) => {
    const HUE = util.input('HUE');
    util.writeLn(`runtime.ext_pen._changePenHueBy(${HUE.asNumber()}, target);`);
};

const setPenShade = /** @param {StatementUtil} util */ (util) => {
    const SHADE = util.input('SHADE');
    util.writeLn(`runtime.ext_pen._setPenShadeToNumber(${SHADE.asNumber()}, target);`);
};
