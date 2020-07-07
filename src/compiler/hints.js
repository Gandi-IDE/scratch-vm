class CompilerHints {
    constructor() {
        /**
         * Whether the current script is explicitly in "warp" mode.
         * The script could still be run in warp mode even if this is false.
         */
        this.isWarp = false;

        /**
         * Whether the current script is a procedure.
         */
        this.isProcedure = false;
    }
}

module.exports = CompilerHints;
