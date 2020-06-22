const Thread = require('../engine/thread');
const Timer = require('../util/timer');

var R = {} // temporary!!!

var jump = (id) => {
    IMMEDIATE = THREAD.functionJumps[id];
};

var jumpLazy = (id) => {
    THREAD.fn = THREAD.functionJumps[id];
};

var enterState = (value) => {
    R = value;
    // TODO
};

var restoreState = () => {
    // TODO
};

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
};

const timer = () => {
    const timer = new Timer();
    timer.start();
    return timer;
};

/** @type {Function} */
var IMMEDIATE;
/** @type {Thread} */
var THREAD;

/**
 * @param {Thread} thread 
 */
const execute = function (thread) {
    THREAD = thread;

    thread.fn();

    while (IMMEDIATE) {
        var fn = IMMEDIATE;
        IMMEDIATE = null;
        fn();
    }
};

const evalCompiledScript = (compiler, _source) => {
    const thread = compiler.thread;
    const target = compiler.target;
    const runtime = target.runtime;
    const stage = runtime.getTargetForStage();

    // no reason to access compiler
    compiler = null;

    // eval will grab references to all variables in this context
    return eval(_source);
};

var createContinuation = (compiler, source) => {
    // TODO: make understandable
    var result = '(function continuation() {\n';
    var brackets = 0;
    var delBrackets = 0;
    var shouldDelete = false;
    var here = 0;
    var length = source.length;
    while (here < length) {
        var i = source.indexOf('{', here);
        var j = source.indexOf('}', here);
        var k = source.indexOf('return;', here);
        if (k === -1) k = length;
        if (i === -1 && j === -1) {
            if (!shouldDelete) {
                result += source.slice(here, k);
            }
            break;
        }
        if (i === -1) i = length;
        if (j === -1) j = length;
        if (shouldDelete) {
            if (i < j) {
                delBrackets++;
                here = i + 1;
            } else {
                delBrackets--;
                if (!delBrackets) {
                    shouldDelete = false;
                }
                here = j + 1;
            }
        } else {
            if (brackets === 0 && k < i && k < j) {
                result += source.slice(here, k);
                break;
            }
            if (i < j) {
                result += source.slice(here, i + 1);
                brackets++;
                here = i + 1;
            } else {
                result += source.slice(here, j);
                here = j + 1;
                if (source.substr(j, 8) === '} else {') {
                    if (brackets > 0) {
                        result += '} else {';
                        here = j + 8;
                    } else {
                        shouldDelete = true;
                        delBrackets = 0;
                    }
                } else {
                    if (brackets > 0) {
                        result += '}';
                        brackets--;
                    }
                }
            }
        }
    }
    result += '})';
    return evalCompiledScript(compiler, result);
};

execute.createContinuation = createContinuation;

module.exports = execute;
