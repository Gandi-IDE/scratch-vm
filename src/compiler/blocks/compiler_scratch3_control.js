const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        control_repeat: repeat,
        control_forever: forever,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        
    };
};

const repeat = (util) => {
    const TIMES = util.getInput('TIMES');
    const SUBSTACK = util.compileSubstack('SUBSTACK');
    const times = util.nextVariable();
    util.writeLn(`var ${times} = ${TIMES};`);
    util.writeLn(`while (${times} >= 0.5) {`);
    util.writeLn(`${times}--;`);
    util.write(SUBSTACK);
    util.yieldLoop();
    util.writeLn(`}`);
};

const forever = (util) => {
    const SUBSTACK = util.compileSubstack('SUBSTACK');
    util.writeLn('while (true) {');
    util.write(SUBSTACK);
    util.yieldLoop();
    util.writeLn('}');
};
