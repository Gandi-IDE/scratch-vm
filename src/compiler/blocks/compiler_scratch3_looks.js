const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        looks_changeeffectby: changeEffect,
        looks_seteffectto: setEffect,
        looks_hide: hide,
        looks_show: show,
        looks_gotofrontback: goToFrontBack,
        looks_goforwardbackwardlayers: goForwardBackwardsLayers,
        looks_setsizeto: setSize,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        
    };
};

const changeEffect = /** @param {StatementUtil} util */ (util) => {
    const EFFECT = util.fieldUnsafe('EFFECT').toLowerCase();
    const CHANGE = util.input('CHANGE');
    if (!util.target.effects.hasOwnProperty(EFFECT)) {
        return;
    }
    // TODO: clampEffect
    util.writeLn(`target.setEffect("${EFFECT}", target.effects["${EFFECT}"] + ${CHANGE.asNumber()});`);
};

const setEffect = /** @param {StatementUtil} util */ (util) => {
    const EFFECT = util.fieldUnsafe('EFFECT').toLowerCase();
    const VALUE = util.input('VALUE');
    if (!util.target.effects.hasOwnProperty(EFFECT)) {
        return;
    }
    // TODO: clampEffect
    util.writeLn(`target.setEffect("${EFFECT}", ${VALUE.asNumber()});`);
};

const hide = /** @param {StatementUtil} util */ (util) => {
    // TODO: _renderBubble
    util.writeLn('target.setVisible(false);');
};

const show = /** @param {StatementUtil} util */ (util) => {
    // TODO: _renderBubble
    util.writeLn('target.setVisible(true);');
};

const goToFrontBack = /** @param {StatementUtil} util */ (util) => {
    if (util.isStage) {
        return;
    }
    const FRONT_BACK = util.fieldUnsafe('FRONT_BACK');
    if (FRONT_BACK === 'front') {
        util.writeLn('target.goToFront();');
    } else {
        util.writeLn('target.goToBack();')
    }
};

const goForwardBackwardsLayers = /** @param {StatementUtil} util */ (util) => {
    if (util.isStage) {
        return;
    }
    const FORWARD_BACKWARD = util.fieldUnsafe('FORWARD_BACKWARD');
    const NUM = util.input('NUM');
    if (FORWARD_BACKWARD === 'forward') {
        util.writeLn(`target.goForwardLayers(${NUM.asNumber()});`);
    } else {
        util.writeLn(`target.goBackwardLayers(${NUM.asNumber()});`);
    }
};

const setSize = /** @param {StatementUtil} util */ (util) => {
    const SIZE = util.input('SIZE');
    util.writeLn(`target.setSize(${SIZE.asNumber()});`);
};
