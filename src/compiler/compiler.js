const ASTGenerator = require('./astgen');
const JSGenerator = require('./jsgen');

const compile = thread => {
    const astGenerator = new ASTGenerator(thread);
    const ast = astGenerator.generate();

    const jsGenerator = new JSGenerator(ast);
    const js = jsGenerator.compile();

    return js;
};

module.exports = compile;
