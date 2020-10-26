const IRGenerator = require('./irgen');
const JSGenerator = require('./jsgen');

const compile = thread => {
    const irGenerator = new IRGenerator(thread);
    const ir = irGenerator.generate();

    const procedures = {};
    const target = thread.target;

    const compileTree = tree => {
        if (tree.cachedCompileResult) {
            return tree.cachedCompileResult;
        }

        const compiler = new JSGenerator(tree, ir, target);
        const result = compiler.compile();
        tree.cachedCompileResult = result;
        return result;
    };

    const entry = compileTree(ir.entry);

    for (const procedureCode of Object.keys(ir.procedures)) {
        const procedureData = ir.procedures[procedureCode];
        const procedureTree = compileTree(procedureData);
        procedures[procedureCode] = procedureTree;
    }

    return {
        startingFunction: entry,
        procedures
    };
};

module.exports = compile;
