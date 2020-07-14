const Constants = require('./constants');

/**
 * Prevents the use of toString() on an object by throwing an error.
 * Useful to make sure that a method is always called, never accidentally stringified.
 * @param {Object} obj
 */
const disableToString = (obj) => {
    obj.toString = () => {
        throw new Error(`toString unexpectedly called on ${obj.name || 'object'}, did you forget to call it?`);
    };
};

class CompiledInput {
    /**
     * @param {string} source The input's source code.
     * @param {number} type The input's type at runtime.
     */
    constructor(source, type) {
        /**
         * The input's source code.
         * @readonly
         * @private
         */
        this.source = source;
        /**
         * The input's type.
         * @readonly
         */
        this.type = type;
        /**
         * Internal flags.
         * @private
         */
        this.flags = 0;
    }

    /**
     * Enable a flag.
     * @param {number} flag The value of the flag to enable.
     */
    setFlag(flag) {
        this.flags |= flag;
        return this;
    }

    toString() {
        return this.source;
    }

    asNumber() {
        if (this.type === Constants.TYPE_NUMBER) {
            if (this.flags & Constants.FLAG_NANABLE) {
                return '(' + this.source + ' || 0)';
            }
            return this.source;
        }
        return '(+' + this.source + ' || 0)';
    }

    asBoolean() {
        if (this.type === Constants.TYPE_BOOLEAN) return this.source;
        return 'toBoolean(' + this.source + ')';
    }

    asString() {
        if (this.type === Constants.TYPE_STRING) return this.source;
        return '("" + ' + this.source + ')';
    }
}

disableToString(CompiledInput.prototype.toString);
disableToString(CompiledInput.prototype.asNumber);
disableToString(CompiledInput.prototype.asString);
disableToString(CompiledInput.prototype.asBoolean);

module.exports = CompiledInput;
