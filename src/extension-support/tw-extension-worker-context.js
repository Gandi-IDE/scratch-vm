module.exports = {
    isWorker: true,
    // centralDispatchService is the object to call postMessage() on to send a message to parent.
    centralDispatchService: self
};
