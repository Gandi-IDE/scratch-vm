const tap = require('tap');
const path = require('path');
const readFileToBuffer = require('../fixtures/readProjectFile').readFileToBuffer;
const VirtualMachine = require('../../src/virtual-machine');
const Runtime = require('../../src/engine/runtime');
const MonitorRecord = require('../../src/engine/monitor-record');
const {Map} = require('immutable');

tap.tearDown(() => process.nextTick(process.exit));

const test = tap.test;

test('spec', t => {
    const r = new Runtime();

    t.type(Runtime, 'function');
    t.type(r, 'object');

    // Test types of cloud data managing functions
    t.type(r.hasCloudData, 'function');
    t.type(r.canAddCloudVariable, 'function');
    t.type(r.addCloudVariable, 'function');
    t.type(r.removeCloudVariable, 'function');

    t.ok(r instanceof Runtime);

    t.end();
});

test('monitorStateEquals', t => {
    const r = new Runtime();
    const id = 'xklj4#!';
    const prevMonitorState = MonitorRecord({
        id,
        opcode: 'turtle whereabouts',
        value: '25'
    });
    const newMonitorDelta = Map({
        id,
        value: String(25)
    });
    r.requestAddMonitor(prevMonitorState);
    r.requestUpdateMonitor(newMonitorDelta);

    t.equals(true, prevMonitorState === r._monitorState.get(id));
    t.equals(String(25), r._monitorState.get(id).get('value'));
    t.end();
});

test('monitorStateDoesNotEqual', t => {
    const r = new Runtime();
    const id = 'xklj4#!';
    const params = {seven: 7};
    const prevMonitorState = MonitorRecord({
        id,
        opcode: 'turtle whereabouts',
        value: '25'
    });

    // Value change
    let newMonitorDelta = Map({
        id,
        value: String(24)
    });
    r.requestAddMonitor(prevMonitorState);
    r.requestUpdateMonitor(newMonitorDelta);

    t.equals(false, prevMonitorState.equals(r._monitorState.get(id)));
    t.equals(String(24), r._monitorState.get(id).get('value'));

    // Prop change
    newMonitorDelta = Map({
        id: 'xklj4#!',
        params: params
    });
    r.requestUpdateMonitor(newMonitorDelta);

    t.equals(false, prevMonitorState.equals(r._monitorState.get(id)));
    t.equals(String(24), r._monitorState.get(id).value);
    t.equals(params, r._monitorState.get(id).params);

    t.end();
});

test('getLabelForOpcode', t => {
    const r = new Runtime();

    const fakeExtension = {
        id: 'fakeExtension',
        name: 'Fake Extension',
        blocks: [
            {
                info: {
                    opcode: 'foo',
                    json: {},
                    text: 'Foo',
                    xml: ''
                }
            },
            {
                info: {
                    opcode: 'foo_2',
                    json: {},
                    text: 'Foo 2',
                    xml: ''
                }
            }
        ]
    };

    r._blockInfo.push(fakeExtension);

    const result1 = r.getLabelForOpcode('fakeExtension_foo');
    t.type(result1.category, 'string');
    t.type(result1.label, 'string');
    t.equals(result1.label, 'Fake Extension: Foo');

    const result2 = r.getLabelForOpcode('fakeExtension_foo_2');
    t.type(result2.category, 'string');
    t.type(result2.label, 'string');
    t.equals(result2.label, 'Fake Extension: Foo 2');

    t.end();
});

test('Project loaded emits runtime event', t => {
    const vm = new VirtualMachine();
    const projectUri = path.resolve(__dirname, '../fixtures/default.sb2');
    const project = readFileToBuffer(projectUri);
    let projectLoaded = false;

    vm.runtime.addListener('PROJECT_LOADED', () => {
        projectLoaded = true;
    });

    vm.loadProject(project).then(() => {
        t.equal(projectLoaded, true, 'Project load event emitted');
        t.end();
    });
});

/*
test('Cloud variable limit allows only 10 cloud variables', t => {
    // This is a test of just the cloud variable limit mechanism
    // The functions being tested below need to be used when
    // creating and deleting cloud variables in the runtime.

    const rt = new Runtime();

    t.equal(rt.hasCloudData(), false);

    for (let i = 0; i < 10; i++) {
        t.equal(rt.canAddCloudVariable(), true);
        rt.addCloudVariable();
        // Adding a cloud variable should change the
        // result of the hasCloudData check
        t.equal(rt.hasCloudData(), true);
    }


    // We should be at the cloud variable limit now
    t.equal(rt.canAddCloudVariable(), false);

    // Removing a cloud variable should allow the addition of exactly one more
    // when we are at the cloud variable limit
    rt.removeCloudVariable();

    t.equal(rt.canAddCloudVariable(), true);
    rt.addCloudVariable();
    t.equal(rt.canAddCloudVariable(), false);

    // Disposing of the runtime should reset the cloud variable limitations
    rt.dispose();
    t.equal(rt.hasCloudData(), false);

    for (let i = 0; i < 10; i++) {
        t.equal(rt.canAddCloudVariable(), true);
        rt.addCloudVariable();
        t.equal(rt.hasCloudData(), true);
    }

    // We should be at the cloud variable limit now
    t.equal(rt.canAddCloudVariable(), false);

    t.end();

});
*/

test('Starting the runtime emits an event', t => {
    let started = false;
    const rt = new Runtime();
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });
    rt.start();
    t.equal(started, true);
    t.end();
});

test('Runtime cannot be started while already running', t => {
    const rt = new Runtime();
    rt.start(); // Start the first time

    // Set up a flag/listener to check if it can be started again
    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });

    // Starting again should not emit another event
    rt.start();
    t.equal(started, false);
    t.end();
});

test('setCompatibilityMode restarts if it was already running', t => {
    const rt = new Runtime();
    rt.start(); // Start the first time

    // Set up a flag/listener to check if it gets started again
    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });

    rt.setCompatibilityMode(true);
    t.equal(started, true);
    t.end();
});

test('setCompatibilityMode does not restart if it was not running', t => {
    const rt = new Runtime();

    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });

    rt.setCompatibilityMode(true);
    t.equal(started, false);
    t.end();
});

test('setFramerate restarts if it was already running', t => {
    const rt = new Runtime();
    rt.start(); // Start the first time

    // Set up a flag/listener to check if it gets started again
    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });

    rt.setFramerate(30);
    t.equal(started, true);
    t.end();
});

test('setFramerate does not restart if it was not running', t => {
    const rt = new Runtime();
    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });
    rt.setFramerate(30);
    t.equal(started, false);
    t.end();
});

test('setFramrate emits an event', t => {
    t.plan(1);
    const rt = new Runtime();
    rt.addListener('FRAMERATE_CHANGED', framerate => {
        if (framerate === 13) {
            t.pass();
        }
    });
    rt.setFramerate(13);
    t.end();
});

test('setFramrate and setCompatibilityMode do not emit a stop event', t => {
    const rt = new Runtime();
    rt.addListener('RUNTIME_STOPPED', () => {
        t.fail();
    });
    rt.setFramerate(13);
    rt.setCompatibilityMode(true);
    t.end();
});

test('setInterpolation emits an event', t => {
    t.plan(1);
    const rt = new Runtime();
    rt.addListener('INTERPOLATION_CHANGED', enabled => {
        if (enabled) {
            t.pass();
        }
    });
    rt.setInterpolation(true);
    t.end();
});

test('setInterpolation does not restart runtime if not running', t => {
    const rt = new Runtime();
    let started = false;
    let stopped = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });
    rt.addListener('RUNTIME_STOPPED', () => {
        stopped = true;
    });
    rt.setInterpolation(true);
    t.equal(started, false);
    t.equal(stopped, false);
    t.end();
});

test('setInterpolation restarts runtime if it is running', t => {
    const rt = new Runtime();
    rt.start();
    let started = false;
    let stopped = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });
    rt.addListener('RUNTIME_STOPPED', () => {
        stopped = true;
    });
    rt.setInterpolation(true);
    t.equal(started, true);
    t.equal(stopped, true);
    t.end();
});

test('Disposing the runtime emits an event', t => {
    let disposed = false;
    const rt = new Runtime();
    rt.addListener('RUNTIME_DISPOSED', () => {
        disposed = true;
    });
    rt.dispose();
    t.equal(disposed, true);
    t.end();
});

test('Clock is reset on runtime dispose', t => {
    const rt = new Runtime();
    const c = rt.ioDevices.clock;
    let simulatedTime = 0;

    c._projectTimer = {
        timeElapsed: () => simulatedTime,
        start: () => {
            simulatedTime = 0;
        }
    };

    t.ok(c.projectTimer() === 0);
    simulatedTime += 1000;
    t.ok(c.projectTimer() === 1);
    rt.dispose();
    // When the runtime is disposed, the clock should be reset
    t.ok(c.projectTimer() === 0);
    t.end();
});

test('Stopping the runtime emits an event', t => {
    const rt = new Runtime();
    rt.start();
    let stopped = false;
    rt.addListener('RUNTIME_STOPPED', () => {
        stopped = true;
    });
    rt.stop();
    t.equal(stopped, true);
    t.end();
});

test('Stop does not emit an event if already stopped', t => {
    const rt = new Runtime();
    let stopped = false;
    rt.addListener('RUNTIME_STOPPED', () => {
        stopped = true;
    });
    rt.stop();
    t.equal(stopped, false);
    t.end();
});

test('setRuntimeOptions emits an event', t => {
    t.plan(1);
    const rt = new Runtime();
    rt.addListener('RUNTIME_OPTIONS_CHANGED', options => {
        if (options.option === 17) {
            t.pass();
        }
    });
    rt.setRuntimeOptions({option: 17});
    t.end();
});

test('setRuntimeOptions supports partial updates', t => {
    t.plan(1);
    const rt = new Runtime();
    rt.setRuntimeOptions({option: 17});
    rt.addListener('RUNTIME_OPTIONS_CHANGED', options => {
        if (options.option === 17) {
            t.pass();
        }
    });
    rt.setRuntimeOptions({otherOption: 1});
    t.end();
});

test('setCompilerOptions emits an event', t => {
    t.plan(1);
    const rt = new Runtime();
    rt.addListener('COMPILER_OPTIONS_CHANGED', options => {
        if (options.option === 17) {
            t.pass();
        }
    });
    rt.setCompilerOptions({option: 17});
    t.end();
});

test('setCompilerOptions supports partial updates', t => {
    t.plan(1);
    const rt = new Runtime();
    rt.setCompilerOptions({option: 17});
    rt.addListener('COMPILER_OPTIONS_CHANGED', options => {
        if (options.option === 17) {
            t.pass();
        }
    });
    rt.setCompilerOptions({otherOption: 1});
    t.end();
});

test('maxClones runtime option', t => {
    const rt = new Runtime();
    rt.setRuntimeOptions({maxClones: 10});
    for (let i = 0; i < 10; i++) {
        t.equal(rt.clonesAvailable(), true);
        rt.changeCloneCounter(1);
    }
    rt.changeCloneCounter(1);
    t.equal(rt.clonesAvailable(), false);
    t.end();
});

test('stageWidth and stageHeight', t => {
    const rt = new Runtime();
    t.equal(rt.stageWidth, 480);
    t.equal(rt.stageHeight, 360);
    t.end();
});

test('debug', t => {
    const rt = new Runtime();
    t.equal(rt.debug, false);
    rt.enableDebug();
    t.equal(rt.debug, true);
    t.end();
});
