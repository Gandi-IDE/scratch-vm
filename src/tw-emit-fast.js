const EventEmitter = require('events');

/* eslint-disable */

// Add emitFast to EventEmitter.
// This is like emit(), but it has less overhead by not supporting everything.
// Notably:
//  - onerror may function differently
//  - only up to 4 parameters allowed
// In performance sensitive code, use this instead of emit()

EventEmitter.prototype.emitFast = function emitFast (type, a, b, c, d) {
    const handler = this._events[type];

    if (!handler) {
        return;
    }

    if (typeof handler === 'function') {
        handler.call(this, a, b, c, d);
    } else {
        const len = handler.length;
        for (var i = 0; i < len; ++i) {
            handler[i].call(this, a, b, c, d);
        }
    }
};
