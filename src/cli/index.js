const fs = require('fs');
const VirtualMachine = require('../index');

/* eslint-disable no-console */

const file = process.argv[2];
if (!file) {
    throw new Error('Invalid file');
}

const runProject = async buffer => {
    const vm = new VirtualMachine();
    vm.runtime.on('SAY', (target, type, text) => {
        console.log(text);
    });
    vm.setCompatibilityMode(true);
    vm.clear();
    await vm.loadProject(buffer);
    vm.start();
    vm.greenFlag();
    await new Promise(resolve => {
        const interval = setInterval(() => {
            let active = 0;
            const threads = vm.runtime.threads;
            for (let i = 0; i < threads.length; i++) {
                if (!threads[i].updateMonitor) {
                    active += 1;
                }
            }
            if (active === 0) {
                clearInterval(interval);
                resolve();
            }
        }, 50);
    });
    vm.stopAll();
    vm.stop();
};

runProject(fs.readFileSync(file));
