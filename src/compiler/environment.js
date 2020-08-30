/* eslint-disable no-eval */

/**
 * @returns {boolean} true if the nullish coalescing operator (x ?? y) is supported.
 * See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing_operator
 */
const supportsNullishCoalescing = () => {
    try {
        eval('undefined ?? 3');
        // if eval succeeds, the browser understood the syntax.
        return true;
    } catch (e) {
        return false;
    }
};

module.exports = {
    supportsNullishCoalescing: supportsNullishCoalescing()
};
