const Thread = require('../engine/thread');
const Timer = require('../util/timer');

var jump = (id) => {
    IMMEDIATE = THREAD.functionJumps[id];
};

var jumpLazy = (id) => {
    if (THREAD.warp) {
        jump(id);
    } else {
        THREAD.fn = THREAD.functionJumps[id];
    }
};

var call = (procedureCode, args, resume) => {
    THREAD.callStack.push(THREAD.call);
    THREAD.call = {
        args,
        resume,
    };
    // TODO: check recursion
    const procedure = THREAD.procedures[procedureCode];
    if (procedure.warp || THREAD.warp) {
        THREAD.warp++;
    }
    jumpLazy(procedure.label);
};

var end = () => {
    if (THREAD.callStack.length > 1) {
        jump(THREAD.call.resume);
        if (THREAD.warp) {
            THREAD.warp--;
        }
        THREAD.call = THREAD.callStack.pop();
    } else {
        retire();
    }
};

var retire = () => {
    THREAD.target.runtime.sequencer.retireThread(THREAD);
};

/**
 * Scratch cast to number.
 * Similar to Cast.toNumber()
 * @param {*} value The value to cast
 * @returns {number}
 */
const toNumber = (value) => {
    // The only falsey values that Number can return is 0 and NaN, both of which are treated as 0.
    return Number(value) || 0;
};

/**
 * Scratch cast to boolean.
 * Similar to Cast.toBoolean()
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
 * Scratch cast to string.
 * Similar to Cast.toString()
 * @param {*} value The value to cast
 * @returns {string}
 */
const toString = (value) => {
    return '' + value;
};

/**
 * Check if a value is considered whitespace.
 * Similar to Cast.isWhiteSpace()
 * @param {*} val Value to check
 * @returns {boolean}
 */
const isWhiteSpace = (val) => {
    return val === null || (typeof val === 'string' && val.trim().length === 0);
}

/**
 * Compare two values using Scratch casting.
 * Similar to Cast.compare()
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

/**
 * Create and start a timer.
 */
const timer = () => {
    const timer = new Timer();
    timer.start();
    return timer;
};

/**
 * Convert a Scratch list index to a JavaScript list index.
 * "all" is not considered as a list index.
 * Similar to Cast.toListIndex()
 * @param {number} index Scratch list index.
 * @param {number} length Length of the list.
 * @returns {number} 0 based list index, or -1 if invalid.
 */
var toListIndex = (index, length) => {
    if (typeof index !== 'number') {
        if (index === 'last') {
            if (length > 0) {
                return length;
            }
            return -1;
        } else if (index === 'random' || index === 'any') {
            if (length > 0) {
                return 1 + Math.floor(Math.random() * length);
            }
            return -1;
        }
    }
    index = Math.floor(toNumber(index));
    if (index < 1 || index > length) {
        return -1;
    }
    return index - 1;
};

const getListItem = (list, idx) => {
    const index = toListIndex(idx, list.value.length);
    if (index === -1) {
        return '';
    }
    return list.value[index];
};

var replaceItemOfList = (list, idx, value) => {
    const index = toListIndex(idx, list.value.length);
    if (index === -1) {
        return;
    }
    list.value[index] = value;
    list._monitorUpToDate = false;
};

/**
 * If set, the executor will immediately start executing this function when the current function returns.
 * @type {Function}
 */
var IMMEDIATE;
/**
 * The currently running thread.
 * @type {Thread}
 */
var THREAD;

/**
 * Step a compiled thread.
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
    // TODO: this is something that definitely deserves unit tests

    // Create some of the data that the script will need to execute.
    const thread = compiler.thread;
    const target = compiler.target;
    const runtime = target.runtime;
    const stage = runtime.getTargetForStage();

    // no reason to access compiler anymore
    compiler = null;

    // eval will grab references to all variables in this context
    return eval(_source);
};

var createContinuation = (compiler, source) => {
    // TODO: optimize, refactor
    // TODO: support more than just "} else {"
    // TODO: this is something that definitely deserves unit tests
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
