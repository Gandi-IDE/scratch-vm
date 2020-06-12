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
    const times = util.nextVariable();
    util.writeLn(`var ${times} = ${TIMES.asNumber()};`);
    util.writeLn(`while (${times} >= 0.5) {`);
    util.writeLn(`${times}--;`);
    util.write(SUBSTACK);
    util.yieldLoop();
    util.writeLn(`}`);
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
    const CONDITION = util.input('CONDITION');
    const SUBSTACK = util.substack('SUBSTACK');
    util.writeLn(`while (!(${CONDITION.asBoolean()})) {`);
    util.write(SUBSTACK);
    util.yieldLoop();
    util.writeLn(`}`);
};

const while_ = /** @param {StatementUtil} util */ (util) => {
    const CONDITION = util.input('CONDITION');
    const SUBSTACK = util.substack('SUBSTACK');
    util.writeLn(`while (${CONDITION.asBoolean()}) {`);
    util.write(SUBSTACK);
    util.yieldLoop();
    util.writeLn(`}`);
};
