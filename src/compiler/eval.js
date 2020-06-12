// eval.js is responsible for eval()ing the generated JS and providing the proper runtime methods and data.

// `eval` is reserved in strict mode
const _eval = (compiler, _source) => {
    // init data
    const thread = compiler.thread;
    const target = compiler.target;
    const stage = target.runtime.getTargetForStage();

    // no reason to access compiler
    compiler = null;

    // eval will grab references to all variables in this context
    return eval(_source);
};

module.exports = _eval;
