/**
 * @typedef {Object} ScriptCacheEntry
 * @property {?CompilationResult} compilationResult
 * @property {boolean} error
 */

class ScriptCache {
    constructor() {
        /**
         * @type {Object.<string, ScriptCacheEntry>}
         * @private
         */
        this.cache = {};
    }

    reset() {
        this.cache = {};
    }

    hasEntry(id) {
        return this.cache.hasOwnProperty(id);
    }

    isCachedAsError(id) {
        return this.cache[id].error;
    }

    getResult(id) {
        return this.cache[id].compilationResult;
    }

    cacheError(id) {
        this.cache[id] = {
            compilationResult: null,
            error: true,
        };
    }

    cacheResult(id, result) {
        this.cache[id] = {
            compilationResult: result,
            error: false,
        };
    }
}

module.exports = ScriptCache;
