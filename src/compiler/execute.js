const Thread = require('../engine/thread');
const Timer = require('../util/timer');
const Cast = require('../util/cast');
const log = require('../util/log');

const compatibilityLayerBlockUtility = require('./compat-block-utility');

// All the functions defined here will be available to compiled scripts.
// The JSDoc annotations define the function's contract.
// Most of these functions are only used at runtime by generated scripts. Despite what your editor may say, they are not unused.

/**
 * End a procedure call.
 */
const endCall = () => {
    if (thread.warp) {
        thread.warp--;
    }
};

/**
 * Start hats by opcode.
 * @param {string} requestedHat The opcode of the hat to start.
 * @param {*} optMatchFields Fields to match.
 * @returns {Array} A list of threads that were started.
 */
const startHats = (requestedHat, optMatchFields) => {
    const threads = thread.target.runtime.startHats(requestedHat, optMatchFields, undefined);
    return threads;
};

/**
 * Implements "thread waiting", where scripts are halted until all the scripts have finished executing.
 * @param {Array} threads The list of threads.
 */
const waitThreads = function*(threads) {
    const runtime = thread.target.runtime;

    while (true) {
        // determine whether any threads are running
        var anyRunning = false;
        for (var i = 0; i < threads.length; i++) {
            if (runtime.threads.indexOf(threads[i]) !== -1) {
                anyRunning = true;
                break;
            }
        }
        if (!anyRunning) {
            // all threads are finished, can resume
            return;
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

        yield;
    }
};

/**
 * Wait until a Promise resolves or rejects before continuing.
 * @param {Promise} promise The promise to wait for.
 * @returns {*} the value that the promise resolves to, otherwise undefined if the promise rejects
 */
const waitPromise = function*(promise) {
    // TODO: there's quite a lot going on in engine/execute.js's handlePromise, we should see how much of that matters to us

    const _thread = thread; // need to store reference to current thread, as promise handlers won't be called from the tick loop
    let returnValue = undefined;

    promise
        .then((value) => {
            returnValue = value;
            _thread.status = Thread.STATUS_RUNNING;
        })
        .catch((error) => {
            _thread.status = Thread.STATUS_RUNNING;
            log.warn('Promise rejected in compiled script:', error);
        });

    // enter STATUS_PROMISE_WAIT and yield, this will stop script execution until the promise handlers reset the thread status
    thread.status = Thread.STATUS_PROMISE_WAIT;
    yield;

    return returnValue;
};

/**
 * Execute a scratch-vm primitive.
 * @param {*} inputs The inputs to pass to the block.
 * @param {function} blockFunction The primitive's function.
 * @returns {*} the value returned by the block, if any.
 */
const executeInCompatibilityLayer = function*(inputs, blockFunction) {
    // reset the stackframe
    // we only ever use one stackframe at a time, so this shouldn't cause issues
    thread.stackFrames[thread.stackFrames.length - 1].reuse(thread.warp > 0);

    const executeBlock = () => {
        compatibilityLayerBlockUtility.thread = thread;
        compatibilityLayerBlockUtility.sequencer = thread.target.runtime.sequencer;
        return blockFunction(inputs, compatibilityLayerBlockUtility);
    };

    const isPromise = (value) => {
        // see engine/execute.js
        return (
            value !== null &&
            typeof value === 'object' &&
            typeof value.then === 'function'
        );
    };

    let returnValue = executeBlock();

    if (isPromise(returnValue)) {
        return yield* waitPromise(returnValue);
    }

    while (thread.status === Thread.STATUS_YIELD || thread.status === Thread.STATUS_YIELD_TICK) {
        // TODO: warp mode
        yield;
        thread.status = Thread.STATUS_RUNNING;
        returnValue = executeBlock();
    }

    return returnValue;
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
    return +value || 0;
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
    return !!value;
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
    let n1 = +v1;
    let n2 = +v2;
    if (n1 === 0 && isWhiteSpace(v1)) {
        n1 = NaN;
    } else if (n2 === 0 && isWhiteSpace(v2)) {
        n2 = NaN;
    }
    if (isNaN(n1) || isNaN(n2)) {
        const s1 = ('' + v1).toLowerCase();
        const s2 = ('' + v2).toLowerCase();
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
    const devObject = thread.target.runtime.ioDevices[device];
    return devObject[func].apply(devObject, args);
};

/**
 * Create and start a timer.
 * @returns {Timer} A started timer
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
                return length - 1;
            }
            return -1;
        } else if (index === 'random' || index === '*') {
            if (length > 0) {
                return Math.floor(Math.random() * length);
            }
            return -1;
        }
        index = toNumber(index);
    }
    index = Math.floor(index);
    if (index < 1 || index > length) {
        return -1;
    }
    return index - 1;
};

/**
 * Get a value from a list.
 * @param {import('../engine/variable')} list The list
 * @param {*} idx The 1-indexed index in the list.
 * @returns The list item, otherwise empty string if it does not exist.
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
 * @param {*} idx The Scratch index in the list.
 * @param {*} value The value to insert.
 */
const listInsert = (list, idx, value) => {
    const index = listIndex(idx, list.value.length + 1);
    if (index === -1) {
        return;
    }
    list.value.splice(index, 0, value);
    list._monitorUpToDate = false;
};

/**
 * Delete a value from a list.
 * @param {import('../engine/variable')} list The list.
 * @param {*} idx The Scratch index in the list.
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
    list.value.splice(index, 1);
    list._monitorUpToDate = false;
};

/**
 * Return whether a list contains a value.
 * @param {import('../engine/variable')} list The list.
 * @param {*} item The value to search for.
 * @returns {boolean} True if the list contains the item
 */
const listContains = (list, item) => {
    // TODO: evaluate whether indexOf is worthwhile here
    if (list.value.indexOf(item) !== -1) {
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
 * Find the 1-indexed index of an item in a list.
 * @param {import('../engine/variable')} list The list.
 * @param {*} item The item to search for
 * @returns {number} The 1-indexed index of the item in the list, otherwise 0
 */
const listIndexOf = (list, item) => {
    for (var i = 0; i < list.value.length; i++) {
        if (compare(list.value[i], item) === 0) {
            return i + 1;
        }
    }
    return 0;
};

/**
 * Get the stringified form of a list.
 * @param {import('../engine/variable')} list The list.
 */
const listContents = (list) => {
    for (let i = 0; i < list.value.length; i++) {
        const listItem = list.value[i];
        if (!(typeof listItem === 'string' && listItem.length === 1)) {
            return list.value.join(' ');
        }
    }
    return list.value.join('');
};

/**
 * Convert a color to an RGB list
 * @param {*} color The color value to convert
 * @return {Array.<number>} [r,g,b], values between 0-255.
 */
const colorToList = (color) => {
    // TODO: remove Cast dependency
    return Cast.toRgbColorList(color);
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
 * The currently running thread.
 * @type {Thread}
 */
var thread;

/**
 * Step a compiled thread.
 * @param {Thread} _thread
 */
const execute = (_thread) => {
    thread = _thread;
    _thread.generator.next();
};

/**
 * eval() some JS
 * @param {string} source
 */
const scopedEval = (source) => {
    try {
        return eval(source);
    } catch (e) {
        console.error('was unable to compile script', source);
        throw e;
    }
};

execute.scopedEval = scopedEval;

module.exports = execute;
