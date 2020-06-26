const { InputUtil, StatementUtil, CompiledInput } = require('../compiler');

/**
 * @returns {Object.<string, (util: StatementUtil) => void>}
 */
module.exports.getStatements = () => {
    return {
        event_broadcast: broadcast,
        event_broadcastandwait: broadcastAndWait,
    };
};

/**
 * @returns {Object.<string, (util: InputUtil) => CompiledInput>}
 */
module.exports.getInputs = () => {
    return {
        event_broadcast_menu: broadcastMenu,
    };
};

const broadcast = /** @param {StatementUtil} util */ (util) => {
    const BROADCAST_INPUT = util.input('BROADCAST_INPUT');
    // TODO: handle when broadcast doesn't exist
    util.writeLn(`startHats("event_whenbroadcastreceived", { BROADCAST_OPTION: ${BROADCAST_INPUT} });`);
};

const broadcastAndWait = /** @param {StatementUtil} util */ (util) => {
    const BROADCAST_INPUT = util.input('BROADCAST_INPUT');
    // TODO: handle when broadcast doesn't exist
    util.waitUntilThreadsComplete(`startHats("event_whenbroadcastreceived", { BROADCAST_OPTION: ${BROADCAST_INPUT} })`);
};

const broadcastMenu = /** @param {InputUtil} util */ (util) => {
    // TODO: see if we should use broadcast ID of name or both
    return util.fieldString('BROADCAST_OPTION');
};
