const ASTGenerator = require('./astgen');
const JSGenerator = require('./jsgen');

const compile = thread => {
    const astGenerator = new ASTGenerator(thread);
    const ast = astGenerator.generate();

    const jsGenerator = new JSGenerator(ast, thread.target);
    const compilationResult = jsGenerator.compile();

    return compilationResult;
};

module.exports = compile;
