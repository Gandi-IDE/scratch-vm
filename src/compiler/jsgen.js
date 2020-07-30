const log = require('../util/log');

class JSGenerator {
    constructor (ast) {
        this.ast = ast;
        this.source = '';
    }

    descendInput (node) {
        switch (node.opcode) {
        
        }
    }

    descendStackedBlock (node) {
        switch (node.opcode) {
        case 'control.while':
            this.source += `while (${this.descendInput().asString()})`;
            break;
        }
    }

    descendStack (nodes) {
        for (const node of nodes) {
            this.descendStackedBlock(node);
        }
    }

    compile () {
        this.descendStack(this.ast.stack);
        return this.source;
    }
}

module.exports = JSGenerator;
