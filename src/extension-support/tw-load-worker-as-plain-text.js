// Based on https://github.com/webpack-contrib/worker-loader/tree/v2.0.0

const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');

module.exports.pitch = function (request) {
    this.cacheable(false);
    const callback = this.async();
    const compiler = this._compilation.createChildCompiler('extension worker', {});
    new SingleEntryPlugin(this.context, `!!${request}`, 'main').apply(compiler);
    compiler.runAsChild((err, entries, compilation) => {
        if (err) return callback(err);
        const file = entries[0].files[0];
        const source = `export default ${JSON.stringify(compilation.assets[file].source())};`;
        return callback(null, source);
    });
};
