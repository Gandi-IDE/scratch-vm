const Thread = require('../engine/thread');
const Sequencer = require('../engine/thread');

/**
 * @param {Sequencer} sequencer 
 * @param {Thread} thread 
 */
const execute = function (sequencer, thread) {
    thread.generator.next();
};

module.exports = execute;
