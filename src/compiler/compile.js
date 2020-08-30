const ASTGenerator = require('./astgen');
const JSGenerator = require('./jsgen');

const compile = thread => {
    const astGenerator = new ASTGenerator(thread);
    const ast = astGenerator.generate();

    const procedures = {};
    const target = thread.target;

    const compileTree = tree => {
        if (tree.cachedCompileResult) {
            return tree.cachedCompileResult;
        }

        const compiler = new JSGenerator(tree, ast, target);
        const result = compiler.compile();
        tree.cachedCompileResult = result;
        return result;
    };

    const entry = compileTree(ast.entry);

    for (const procedureCode of Object.keys(ast.procedures)) {
        const procedureData = ast.procedures[procedureCode];
        const procedureTree = compileTree(procedureData);
        procedures[procedureCode] = procedureTree;
    }

    return {
        startingFunction: entry,
        procedures
    };
};

module.exports = compile;
