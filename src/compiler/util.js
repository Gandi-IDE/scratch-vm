/**
 * Disable the toString() method on an object by making it throw when called.
 * This is useful if you want to make sure that you can't accidentally stringify a value that shouldn't be stringified.
 * @param {*} obj Object to disable the toString() method on
 */
const disableToString = obj => {
    obj.toString = () => {
        throw new Error(`toString unexpectedly called on ${obj.name || 'object'}`);
    };
};

module.exports = {
    disableToString
};
