const execute = function (sequencer, thread) {
    const result = thread.generator.next();
    
    if (result.done) {
        sequencer.retireThread(thread);
    }
};

module.exports = execute;
