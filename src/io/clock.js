const Timer = require('../util/timer');

class Clock {
    constructor (runtime) {
        this._projectTimer = new Timer({now: () => runtime.currentMSecs});
        this._projectTimer.start();
        // tw: add a "precise" timer that uses real time instead of runtime.currentMSecs
        this._preciseProjectTimer = new Timer();
        this._preciseProjectTimer.start();
        this._pausedTime = null;
        this._paused = false;
        /**
         * Reference to the owning Runtime.
         * @type{!Runtime}
         */
        this.runtime = runtime;
    }

    projectTimer () {
        if (this._paused) {
            return this._pausedTime / 1000;
        }
        return this._projectTimer.timeElapsed() / 1000;
    }

    // tw: expose preciseProjectTimer
    preciseProjectTimer () {
        if (this._paused) {
            return this._pausedTime / 1000;
        }
        return this._preciseProjectTimer.timeElapsed() / 1000;
    }

    pause () {
        this._paused = true;
        this._pausedTime = this._projectTimer.timeElapsed();
    }

    resume () {
        this._paused = false;
        const dt = this._projectTimer.timeElapsed() - this._pausedTime;
        this._projectTimer.startTime += dt;
        // tw: also resume precise timer
        this._preciseProjectTimer.startTime += dt;
    }

    resetProjectTimer () {
        this._projectTimer.start();
        // tw: also reset precise timer
        this._preciseProjectTimer.start();
    }
}

module.exports = Clock;
