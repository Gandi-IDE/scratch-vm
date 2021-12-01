const test = require('tap').test;

const Runtime = require('../../src/engine/runtime');
const Scratch3PenBlocks = require('../../src/extensions/scratch3_pen/index');

test('_clampPenSize', t => {
    const rt = new Runtime();
    const pen = new Scratch3PenBlocks(rt);

    t.equal(pen._clampPenSize(-1), 1);
    t.equal(pen._clampPenSize(0), 1);
    t.equal(pen._clampPenSize(0.25), 1);
    t.equal(pen._clampPenSize(1), 1);
    t.equal(pen._clampPenSize(10), 10);
    t.equal(pen._clampPenSize(1000), 1000);
    t.equal(pen._clampPenSize(1200), 1200);
    t.equal(pen._clampPenSize(1201), 1200);

    rt.setRuntimeOptions({
        miscLimits: false
    });
    t.equal(pen._clampPenSize(-1), 0);
    t.equal(pen._clampPenSize(0), 0);
    t.equal(pen._clampPenSize(0.25), 0.25);
    t.equal(pen._clampPenSize(1), 1);
    t.equal(pen._clampPenSize(10), 10);
    t.equal(pen._clampPenSize(1000), 1000);
    t.equal(pen._clampPenSize(1200), 1200);
    t.equal(pen._clampPenSize(1201), 1201);

    t.end();
});
