const IRGenerator = require('./irgen');
const JSGenerator = require('./jsgen');

const compile = thread => {
    const irGenerator = new IRGenerator(thread);
    const ir = irGenerator.generate();

    const procedures = {};
    const target = thread.target;

    const compileScript = script => {
        if (script.cachedCompileResult) {
            return script.cachedCompileResult;
        }

        const compiler = new JSGenerator(script, ir, target);
        const result = compiler.compile();
        script.cachedCompileResult = result;
        return result;
    };

    const entry = compileScript(ir.entry);

    for (const procedureCode of Object.keys(ir.procedures)) {
        const procedureData = ir.procedures[procedureCode];
        const procedureTree = compileScript(procedureData);
        procedures[procedureCode] = procedureTree;
    }

    return {
        startingFunction: entry,
        procedures
    };
};

module.exports = compile;
