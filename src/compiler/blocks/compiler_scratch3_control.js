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
    // util.writeLn('save();');
    util.writeLn(`R.count = ${TIMES.asNumber()};`);
    const label = util.putLabel();
    util.writeLn('if (R.count >= 0.5) {');
    util.writeLn('  R.count -= 1;');
    util.write(SUBSTACK);
    util.jumpLazy(label);
    util.writeLn('} else {');
    // util.writeLn('  restore();');
    util.writeLn('}');
};

const forever = /** @param {StatementUtil} util */ (util) => {
    const SUBSTACK = util.substack('SUBSTACK');
    util.writeLn('while (true) {');
    util.write(SUBSTACK);
    util.yieldLoop();
    util.writeLn('}');
};

const if_ = /** @param {StatementUtil} util */ (util) => {
    const CONDITION = util.input('CONDITION');
    const SUBSTACK = util.substack('SUBSTACK');
    util.writeLn(`if (${CONDITION.asBoolean()}) {`);
    util.write(SUBSTACK);
    util.writeLn(`}`);
};

const repeatUntil = /** @param {StatementUtil} util */ (util) => {

};

const while_ = /** @param {StatementUtil} util */ (util) => {

};
