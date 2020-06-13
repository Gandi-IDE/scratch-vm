// eval.js is responsible for eval()ing the generated JS and providing the proper runtime methods and data.

/**
 * Scratch cast to number.
 * @param {*} value The value to cast
 * @returns {number}
 */
const toNumber = (value) => {
    // The only falsey values that Number can return is 0 and NaN, both of which are treated as 0.
    return Number(value) || 0;
};

/**
 * Scratch cast to boolean
 * @param {*} value The value to cast
 * @returns {boolean}
 */
const toBoolean = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        if (value === '' || value === '0' || value.toLowerCase() === 'false') {
            return false;
        }
        return true;
    }
    return Boolean(value);
};

/**
 * Scratch cast to string
 * @param {*} value The value to cast
 * @returns {string}
 */
const toString = (value) => {
    return '' + value;
};

/**
 * Check if a value is considered whitespace.
 * @param {*} val Value to check
 * @returns {boolean}
 */
const isWhiteSpace = (val) => {
    return val === null || (typeof val === 'string' && val.trim().length === 0);
}

/**
 * Compare two values using Scratch casting.
 * @param {*} v1 First value to compare.
 * @param {*} v2 Second value to compare.
 * @returns {number} Negative if v1 < v2, 0 if equal, positive if v1 > v2
 */
const compare = (v1, v2) => {
    let n1 = Number(v1);
    let n2 = Number(v2);
    if (n1 === 0 && isWhiteSpace(v1)) {
        n1 = NaN;
    } else if (n2 === 0 && isWhiteSpace(v2)) {
        n2 = NaN;
    }
    if (isNaN(n1) || isNaN(n2)) {
        const s1 = String(v1).toLowerCase();
        const s2 = String(v2).toLowerCase();
        if (s1 < s2) {
            return -1;
        } else if (s1 > s2) {
            return 1;
        }
        return 0;
    }
    if (
        (n1 === Infinity && n2 === Infinity) ||
        (n1 === -Infinity && n2 === -Infinity)
    ) {
        return 0;
    }
    return n1 - n2;
};

const ioQuery = (runtime, device, func, args) => {
    if (
        runtime.ioDevices[device] &&
        runtime.ioDevices[device][func]) {
        const devObject = runtime.ioDevices[device];
        return devObject[func].apply(devObject, args);
    }
}

// `eval` is reserved in strict mode
const eval_ = (compiler, _source) => {
    // init data
    const thread = compiler.thread;
    const target = compiler.target;
    const stage = target.runtime.getTargetForStage();

    // no reason to access compiler
    compiler = null;

    // eval will grab references to all variables in this context
    return eval(_source);
};

module.exports = eval_;
