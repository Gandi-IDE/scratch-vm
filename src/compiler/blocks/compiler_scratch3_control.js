const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        control_forever: forever,
        control_if: if_,
        control_repeat: repeat,
        control_repeat_until: repeatUntil,
        control_while: while_,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        
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
