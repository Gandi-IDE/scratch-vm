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
        pen_changePenColorParamBy: changePenColorParamBy,
        pen_setPenColorParamTo: setPenColorParamTo,
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
        pen_menu_colorParam: colorParamMenu,
    };
};

const pen = 'runtime.ext_pen';
const penState = `${pen}._getPenState(target)`;

const clear = /** @param {StatementUtil} util */ (util) => {
    util.writeLn(`${pen}.clear();`);
};

const setPenColor = /** @param {StatementUtil} util */ (util) => {
    const COLOR = util.input('COLOR');
    util.writeLn(`${pen}._setPenColorToColor(${COLOR}, target);`);
};

const penDown = /** @param {StatementUtil} util */ (util) => {
    util.writeLn(`${pen}._penDown(target);`);
};

const penUp = /** @param {StatementUtil} util */ (util) => {
    util.writeLn(`${pen}._penUp(target);`);
};

const setPenSize = /** @param {StatementUtil} util */ (util) => {
    const SIZE = util.input('SIZE');
    util.writeLn(`${pen}._setPenSizeTo(${SIZE.asNumber()}, target);`);
};

const changePenSize = /** @param {StatementUtil} util */ (util) => {
    const SIZE = util.input('SIZE');
    util.writeLn(`${pen}._changePenSizeBy(${SIZE.asNumber()}, target);`);
};

const changePenHueBy = /** @param {StatementUtil} util */ (util) => {
    const HUE = util.input('HUE');
    util.writeLn(`${pen}._changePenHueBy(${HUE.asNumber()}, target);`);
};

const setPenShade = /** @param {StatementUtil} util */ (util) => {
    const SHADE = util.input('SHADE');
    util.writeLn(`${pen}._setPenShadeToNumber(${SHADE.asNumber()}, target);`);
};

const setPenColorParamTo = /** @param {StatementUtil} util */ (util) => {
    const COLOR_PARAM = util.input('COLOR_PARAM');
    const VALUE = util.input('VALUE');
    util.writeLn(`${pen}._setOrChangeColorParam(${COLOR_PARAM}, ${VALUE.asNumber()}, ${penState}, false);`);
};

const changePenColorParamBy = /** @param {StatementUtil} util */ (util) => {
    const COLOR_PARAM = util.input('COLOR_PARAM');
    const VALUE = util.input('VALUE');
    util.writeLn(`${pen}._setOrChangeColorParam(${COLOR_PARAM}, ${VALUE.asNumber()}, ${penState}, true);`);
};

const colorParamMenu = /** @param {InputUtil} util */ (util) => {
    return util.fieldString('colorParam');
};
