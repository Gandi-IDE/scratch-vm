const optimize = audioEngine => {
    audioEngine.effects.forEach(Effect => {
        const originalSet = Effect.prototype._set;
        Effect.prototype._set = function (value) {
            if (this.__value === value) {
                return;
            }
            this.__value = value;
            originalSet.call(this, value);
        };
    });
};

module.exports = optimize;
