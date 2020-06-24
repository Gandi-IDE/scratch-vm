const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        looks_say: say,
        looks_changeeffectby: changeEffect,
        looks_seteffectto: setEffect,
        looks_hide: hide,
        looks_show: show,
        looks_gotofrontback: goToFrontBack,
        looks_goforwardbackwardlayers: goForwardBackwardsLayers,
        looks_setsizeto: setSize,
        looks_switchcostumeto: switchCostume,
        looks_cleargraphiceffects: clearEffects,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        looks_costume: costumeMenu,
        looks_costumenumbername: getCostumeNumberName,
    };
};

const say = /** @param {StatementUtil} util */ (util) => {
    const MESSAGE = util.input('MESSAGE');
    util.writeLn(`runtime.ext_scratch3_looks._say(${MESSAGE}, target);`);
};

const changeEffect = /** @param {StatementUtil} util */ (util) => {
    const EFFECT = util.fieldValueUnsafe('EFFECT').toLowerCase();
    const CHANGE = util.input('CHANGE');
    if (!util.target.effects.hasOwnProperty(EFFECT)) {
        return;
    }
    // TODO: clampEffect
    util.writeLn(`target.setEffect("${EFFECT}", target.effects["${EFFECT}"] + ${CHANGE.asNumber()});`);
};

const setEffect = /** @param {StatementUtil} util */ (util) => {
    const EFFECT = util.fieldValueUnsafe('EFFECT').toLowerCase();
    const VALUE = util.input('VALUE');
    if (!util.target.effects.hasOwnProperty(EFFECT)) {
        return;
    }
    // TODO: clampEffect
    util.writeLn(`target.setEffect("${EFFECT}", ${VALUE.asNumber()});`);
};

const hide = /** @param {StatementUtil} util */ (util) => {
    util.writeLn('target.setVisible(false);');
    util.writeLn('runtime.ext_scratch3_looks._renderBubble(target);');
};

const show = /** @param {StatementUtil} util */ (util) => {
    util.writeLn('target.setVisible(true);');
    util.writeLn('runtime.ext_scratch3_looks._renderBubble(target);');
};

const goToFrontBack = /** @param {StatementUtil} util */ (util) => {
    if (util.isStage) {
        return;
    }
    const FRONT_BACK = util.fieldValueUnsafe('FRONT_BACK');
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
    const FORWARD_BACKWARD = util.fieldValueUnsafe('FORWARD_BACKWARD');
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

const switchCostume = /** @param {StatementUtil} util */ (util) => {
    const COSTUME = util.input('COSTUME');
    util.writeLn(`runtime.ext_scratch3_looks._setCostume(target, ${COSTUME});`);
};

const costumeMenu = /** @param {InputUtil} util */ (util) => {
    return util.fieldString('COSTUME');
};

const getCostumeNumberName = /** @param {InputUtil} util */ (util) => {
    const NUMBER_NAME = util.fieldValueUnsafe('NUMBER_NAME');
    if (NUMBER_NAME === 'number') {
        return util.number('(target.currentCostume + 1)');
    }
    return util.string('target.getCostumes()[target.currentCostume].name');
};

const clearEffects = /** @param {StatementUtil} util */ (util) => {
    util.writeLn(`target.clearEffects();`);
};
