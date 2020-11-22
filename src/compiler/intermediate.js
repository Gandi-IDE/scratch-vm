class IntermediateScript {
    constructor () {
        this.stack = null;

        this.isProcedure = false;
        this.procedureCode = '';
        this.arguments = [];

        this.isWarp = false;

        this.yields = false;

        this.warpTimer = false;

        this.dependedProcedures = [];

        this.cachedCompileResult = null;
    }
}

class IntermediateRepresentation {
    constructor () {
        /**
         * @type {IntermediateScript}
         */
        this.entry = null;

        /**
         * @type {Object.<string, IntermediateScript>}
         */
        this.procedures = {};
    }
}

module.exports = {
    IntermediateScript,
    IntermediateRepresentation
};
