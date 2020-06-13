const Thread = require('../engine/thread');
const Sequencer = require('../engine/thread');

/**
 * @param {Thread} thread 
 */
const execute = function (thread) {
    thread.generator.next();
};

module.exports = execute;
