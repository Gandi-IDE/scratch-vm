const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        control_forever: forever,
        control_if: if_,
        control_if_else: ifElse,
        control_repeat: repeat,
        control_repeat_until: repeatUntil,
        control_while: while_,
        control_wait: wait,
        control_create_clone_of: createClone,
        control_delete_this_clone: deleteClone,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        control_create_clone_of_menu: createCloneMenu,
    };
};

const repeat = /** @param {StatementUtil} util */ (util) => {
    const TIMES = util.input('TIMES');
    const SUBSTACK = util.substack('SUBSTACK');
    util.enterState(TIMES.asNumber());
    const label = util.putLabel();
    util.writeLn('if (R >= 0.5) {');
    util.writeLn('  R -= 1;');
    util.write(SUBSTACK);
    util.jumpLazy(label);
    util.writeLn('} else {');
    util.restoreState();
    util.writeLn('}');
};

const forever = /** @param {StatementUtil} util */ (util) => {
    const SUBSTACK = util.substack('SUBSTACK');
    const label = util.putLabel();
    util.write(SUBSTACK);
    util.jumpLazy(label);
};

const if_ = /** @param {StatementUtil} util */ (util) => {
    const CONDITION = util.input('CONDITION');
    const SUBSTACK = util.substack('SUBSTACK');
    util.writeLn(`if (${CONDITION.asBoolean()}) {`);
    util.write(SUBSTACK);
    util.writeLn(`}`);
};

const ifElse = /** @param {StatementUtil} util */ (util) => {
    const CONDITION = util.input('CONDITION');
    const SUBSTACK = util.substack('SUBSTACK');
    const SUBSTACK2 = util.substack('SUBSTACK2');
    util.writeLn(`if (${CONDITION.asBoolean()}) {`);
    util.write(SUBSTACK);
    util.writeLn(`} else {`);
    util.write(SUBSTACK2);
    util.writeLn(`}`);
};

const repeatUntil = /** @param {StatementUtil} util */ (util) => {
    const CONDITION = util.input('CONDITION');
    const SUBSTACK = util.substack('SUBSTACK');
    const label = util.putLabel();
    util.writeLn(`if (!${CONDITION.asBoolean()}) {`);
    util.write(SUBSTACK);
    util.writeLn(`}`);
    util.jumpLazy(label);
};

const while_ = /** @param {StatementUtil} util */ (util) => {
    const CONDITION = util.input('CONDITION');
    const SUBSTACK = util.substack('SUBSTACK');
    const label = util.putLabel();
    util.writeLn(`if (${CONDITION.asBoolean()}) {`);
    util.write(SUBSTACK);
    util.writeLn(`}`);
    util.jumpLazy(label);
};

const wait = /** @param {StatementUtil} util */ (util) => {
    const DURATION = util.input('DURATION');
    util.writeLn(`enterState({ timer: timer(), duration: Math.max(0, 1000 * ${DURATION.asNumber()}) });`);
    const label = util.putLabel();
    // TODO: always jumpLazy the first time
    util.writeLn('if (R.timer.timeElapsed() < R.duration) {')
    util.jumpLazy(label);
    util.writeLn('}');
};

const createClone = /** @param {StatementUtil} util */ (util) => {
    const CLONE_OPTION = util.input('CLONE_OPTION');
    util.writeLn(`runtime.ext_scratch3_control._createClone(${CLONE_OPTION.asString()}, target);`);
};

const createCloneMenu = /** @param {InputUtil} util */ (util) => {
    return util.fieldString('CLONE_OPTION');
};

const deleteClone = /** @param {StatementUtil} util */ (util) => {
    if (util.target.isOriginal) return;
    util.writeLn(`runtime.disposeTarget(target);`);
    util.writeLn(`runtime.stopForTarget(target);`);
    util.writeLn(`return;`);
};
