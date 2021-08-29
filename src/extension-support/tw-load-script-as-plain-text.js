// Based on https://github.com/webpack-contrib/worker-loader/tree/v2.0.0

const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');

module.exports.pitch = function (request) {
    // Temporary hack to allow TW Desktop to avoid nonsensical errors
    if (process.env.TW_DISABLE_PLAIN_TEXT_LOADER) {
        return 'throw new Error("Loader was disabled at build time");';
    }
    // Technically this loader does work in other environments, but our use case does not want that.
    if (this.target !== 'web') {
        return 'throw new Error("Not supported in non-web environment");';
    }
    this.cacheable(false);
    const callback = this.async();
    const compiler = this._compilation.createChildCompiler('extension worker', {});
    new SingleEntryPlugin(this.context, `!!${request}`, 'main').apply(compiler);
    compiler.runAsChild((err, entries, compilation) => {
        if (err) return callback(err);
        const file = entries[0].files[0];
        const source = `module.exports = ${JSON.stringify(compilation.assets[file].source())};`;
        return callback(null, source);
    });
};
