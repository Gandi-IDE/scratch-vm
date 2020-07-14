const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');
const scratch3_data = require('./compiler_scratch3_data');

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
        control_wait_until: waitUntil,
        control_stop: stop,
        control_for_each: forEach,
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
    const i = util.var();
    util.writeLn(`for (var ${i} = ${TIMES}; ${i} >= 0.5; ${i}--) {`)
    util.write(SUBSTACK);
    util.yieldNotWarp();
    util.writeLn(`}`);
};

const forever = /** @param {StatementUtil} util */ (util) => {
    const SUBSTACK = util.substack('SUBSTACK');
    util.writeLn('while (true) {');
    util.write(SUBSTACK);
    util.yieldNotWarp();
    util.writeLn('}');
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
    util.writeLn(`while (!${CONDITION.asBoolean()}) {`);
    util.write(SUBSTACK);
    util.yieldNotWarp();
    util.writeLn('}');
};

const while_ = /** @param {StatementUtil} util */ (util) => {
    const CONDITION = util.input('CONDITION');
    const SUBSTACK = util.substack('SUBSTACK');
    util.writeLn(`while (${CONDITION.asBoolean()}) {`);
    util.write(SUBSTACK);
    util.yieldNotWarp();
    util.writeLn('}');
};

const wait = /** @param {StatementUtil} util */ (util) => {
    const DURATION = util.input('DURATION');
    const timer = util.var();
    const duration = util.var();
    // always yield once
    // TODO: YIELD_TICK instead
    util.yieldNotWarp();
    util.writeLn(`var ${timer} = timer();`);
    util.writeLn(`var ${duration} = Math.max(0, 1000 * ${DURATION.asNumber()})`);
    util.writeLn(`while (${timer}.timeElapsed() < ${duration}) {`)
    util.yieldNotWarp();
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
    // TODO: actually stop thread
    util.writeLn(`if (!target.isOriginal) {`)
    util.writeLn(`  runtime.disposeTarget(target);`);
    util.writeLn(`  runtime.stopForTarget(target);`);
    util.retire();
    util.writeLn(`}`);
};

const stop = /** @param {StatementUtil} util */ (util) => {
    const STOP_OPTION = util.fieldValueUnsafe('STOP_OPTION');
    if (STOP_OPTION === 'all') {
        util.writeLn('runtime.stopAll();');
        util.retire();
    } else if (STOP_OPTION === 'other scripts in sprite' || STOP_OPTION === 'other scripts in stage') {
        util.writeLn('runtime.stopForTarget(target, thread);');
    } else if (STOP_OPTION === 'this script') {
        if (util.compiler.isProcedure) {
            util.writeLn('endCall(); return;');
        } else {
            util.retire();
        }
    }
};

const waitUntil = /** @param {StatementUtil} util */ (util) => {
    const CONDITION = util.input('CONDITION');
    util.writeLn(`while (!${CONDITION.asBoolean()}) {`);
    util.yieldNotWarp();
    util.writeLn('}');
};

const forEach = /** @param {StatementUtil} util */ (util) => {
    const VARIABLE = scratch3_data.variableReference(util);
    const VALUE = util.input('VALUE');
    const SUBSTACK = util.substack('SUBSTACK');
    const index = util.var();
    util.writeLn(`var ${index} = 0;`);
    util.writeLn(`while (${index} < ${VALUE.asNumber()}) { ${index}++; ${VARIABLE}.value = ${index};`);
    util.write(SUBSTACK);
    util.yieldNotWarp();
    util.writeLn(`}`);
};
