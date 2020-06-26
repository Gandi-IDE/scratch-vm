const Thread = require('../engine/thread');
const Timer = require('../util/timer');

// All the functions defined here will be available to compiled scripts.
// The JSDoc annotations define the function's contract.
// Most of these functions are only used at runtime by generated scripts. Despite what your editor may say, they are not unused.

/**
 * Immediately jump to a label.
 * @param {number} id The label to jump to.
 */
const jump = (id) => {
    immediate = thread.jumps[id];
};

/**
 * Jump to a label.
 * If in warp mode, this will be instant (like jump())
 * Otherwise, this jump will occur in the next tick loop.
 * @param {number} id The label to jump to.
 */
const jumpLazy = (id) => {
    if (thread.warp) {
        jump(id);
    } else {
        thread.fn = thread.jumps[id];
    }
};

/**
 * Call into a procedure.
 * @param {string} procedureCode The procedure's name
 * @param {*} args The arguments to pass to the procedure.
 * @param {number} resume The label to return to when the procedure completes.
 */
const call = (procedureCode, args, resume) => {
    thread.callStack.push(thread.call);
    thread.call = {
        args,
        resume,
    };
    // TODO: check recursion
    const procedure = thread.procedures[procedureCode];
    if (procedure.warp || thread.warp) {
        thread.warp++;
    }
    jump(procedure.label);
};

/**
 * End a script or procedure call.
 */
const end = () => {
    if (thread.callStack.length) {
        jump(thread.call.resume);
        if (thread.warp) {
            thread.warp--;
        }
        thread.call = thread.callStack.pop();
    } else {
        retire();
    }
};

/**
 * Start hats by opcode.
 * @param {string} requestedHat The opcode of the hat to start.
 * @param {*} optMatchFields Fields to match.
 * @returns {Array} A list of threads that were started.
 */
const startHats = (requestedHat, optMatchFields) => {
    const threads = target.runtime.startHats(requestedHat, optMatchFields, undefined);
    return threads;
};

/**
 * Implements "thread waiting", where scripts are halted until all the scripts have finished executing.
 * Threads are considered "active" if they are still in the thread list, even if they have STATUS_DONE.
 * The current thread's status may be changed to STATUS_YIELD_TICK if all active threads are waiting.
 * @param {Array} threads The list of threads.
 * @returns {boolean} true if the script should keep waiting on threads to complete
 */
const waitThreads = (threads) => {
    const runtime = thread.target.runtime;

    // determine whether any threads are running
    var anyRunning = false;
    for (var i = 0; i < threads.length; i++) {
        if (runtime.threads.indexOf(threads[i]) !== -1) {
            anyRunning = true;
            break;
        }
    }
    if (!anyRunning) {
        return false;
    }

    var allWaiting = true;
    for (var i = 0; i < threads.length; i++) {
        if (!runtime.isWaitingThread(threads[i])) {
            allWaiting = false;
            break;
        }
    }
    if (allWaiting) {
        thread.status = 3; // STATUS_YIELD_TICK
    }

    return true;
};

/**
 * End the current script.
 */
const retire = () => {
    thread.target.runtime.sequencer.retireThread(thread);
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
 * Converts a number to ensure that NaN becomes 0.
 * @param {number} number The value to convert.
 * @returns {number}
 */
const toNotNaN = (number) => {
    return number || 0;
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

/**
 * Perform an IO query
 * @param {string} device
 * @param {string} func
 * @param {*} args
 * @returns {*}
 */
const ioQuery = (device, func, args) => {
    // We will assume that the device always exists.
    const devObject = target.runtime.ioDevices[device];
    return devObject[func].apply(devObject, args);
};

/**
 * Create and start a timer.
 * @returns {Timer}
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
var listIndex = (index, length) => {
    if (typeof index !== 'number') {
        if (index === 'last') {
            if (length > 0) {
                return length;
            }
            return -1;
        } else if (index === 'random' || index === '*') {
            if (length > 0) {
                return Math.floor(Math.random() * length);
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

/**
 * Get a value from a list.
 * @param {import('../engine/variable')} list The list
 * @param {*} idx The 1-indexed index in the list.
 */
const listGet = (list, idx) => {
    const index = listIndex(idx, list.value.length);
    if (index === -1) {
        return '';
    }
    return list.value[index];
};

/**
 * Replace a value in a list.
 * @param {import('../engine/variable')} list The list
 * @param {*} idx List index, Scratch style.
 * @param {*} value The new value.
 */
const listReplace = (list, idx, value) => {
    const index = listIndex(idx, list.value.length);
    if (index === -1) {
        return;
    }
    list.value[index] = value;
    list._monitorUpToDate = false;
};

/**
 * Insert a value in a list.
 * @param {import('../engine/variable')} list The list.
 * @param {any} idx The Scratch index in the list.
 * @param {any} value The value to insert.
 */
const listInsert = (list, idx, value) => {
    const index = listIndex(idx, list.value.length + 1);
    if (index === -1) {
        return;
    }
    list.value.splice(index - 1, 0, value);
    list._monitorUpToDate = false;
};

/**
 * Delete a value from a list.
 * @param {import('../engine/variable')} list The list.
 * @param {any} idx The Scratch index in the list.
 */
const listDelete = (list, idx) => {
    if (idx === 'all') {
        list.value = [];
        return;
    }
    const index = listIndex(idx, list.value.length);
    if (index === -1) {
        return;
    }
    list.value.splice(index - 1, 1);
    list._monitorUpToDate = false;
};

/**
 * Return whether a list contains a value.
 * @param {import('../engine/variable')} list The list.
 * @param {any} item The value to search for.
 * @returns {boolean}
 */
const listContains = (list, item) => {
    // TODO: evaluate whether indexOf is worthwhile here
    if (list.value.indexOf(item) !== 0) {
        return true;
    }
    for (let i = 0; i < list.value.length; i++) {
        if (compare(list.value[i], item) === 0) {
            return true;
        }
    }
    return false;
};

/**
 * Implements Scratch modulo (floored division instead of truncated division)
 * @param {number} n
 * @param {number} modulus
 * @returns {number}
 */
const mod = (n, modulus) => {
    let result = n % modulus;
    if (result / modulus < 0) result += modulus;
    return result;
};

/**
 * If set, the executor will immediately start executing this function when the current function returns.
 * @type {Function}
 */
var immediate;
/**
 * The currently running thread.
 * @type {Thread}
 */
var thread;
/**
 * The target of the current thread.
 * @type {Target}
 */
var target;

/**
 * Step a compiled thread.
 * @param {Thread} _thread
 */
const execute = (_thread) => {
    thread = _thread;
    target = thread.target;

    _thread.fn();

    while (immediate) {
        var fn = immediate;
        immediate = null;
        fn();
    }
};

/**
 * Evaluate a continuation from its source code.
 * Prepares the necessary environment.
 * @param {Compiler} compiler
 * @param {string} _source
 */
const evalCompiledScript = (compiler, _source) => {
    // Cache some of the data that the script will need to execute.
    const runtime = compiler.target.runtime;
    const stage = runtime.getTargetForStage();

    // no reason to access compiler anymore
    compiler = null;

    // eval will grab references to all variables in this context
    return eval(_source);
};

const createContinuation = (compiler, source) => {
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
