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
            try {
                handler[i].call(this, a, b, c, d);
            } catch (error) {
                //
                // 某些情况下，可能会抛出异常，比如：
                // 连续打开 《保护滑稽》这个作品的sb3，第二次之后会抛出异常
                // 具体是handler被call之后会移除，导致handler数组数组长度改编
                // 不会有任何影响
                // root case 未能准确定位，怀疑是循环中使用克隆体并且频繁的使用【显示】【隐藏】导致同一个 event 被 addListener 多次导致的
                // 暂时catch一下，不影响使用
            }
        }
    }
};
