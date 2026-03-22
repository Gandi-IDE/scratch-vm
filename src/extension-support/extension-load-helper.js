// output a Scratch Object contains APIs all extension needed
const BlockType = require('./block-type');
const ArgumentType = require('./argument-type');
const TargetType = require('./target-type');
const Cast = require('../util/cast');
const Color = require('../util/color');
const createTranslate = require('./tw-l10n');
const log = require('../util/log');
const AsyncLimiter = require('../util/async-limiter');

let openVM = null;
let translate = null;

const clearScratchAPI = () => {
    delete global.IIFEExtensionInfoList;
    if (global.Scratch) {
        global.Scratch.extensions = {
            unsandboxed: true,
            register: extensionInstance => {
                const info = extensionInstance.getInfo();
                throw new Error(`ScratchAPI: ${info.id} call extensions.register too late`);
            }
        };
        global.Scratch.vm = null;
        global.Scratch.runtime = null;
        global.Scratch.renderer = null;
    }
};

const setupScratchAPI = (vm) => {
    const registerExt = extensionInstance => {
        const info = extensionInstance.getInfo();
        const extensionId = info.id;
        const extensionObject = {
            info: {
                name: info.name,
                extensionId
            },
            Extension: () => extensionInstance.constructor
        };
        global.IIFEExtensionInfoList = global.IIFEExtensionInfoList || [];
        global.IIFEExtensionInfoList.push({extensionObject, extensionInstance});
        return;
    };

    if (!openVM) {
        const {runtime} = vm;
        if (runtime.ccwAPI && runtime.ccwAPI.getOpenVM) {
            openVM = runtime.ccwAPI.getOpenVM();
        }
        openVM = {
            runtime: vm.runtime,
            exports: vm.exports,
            ...openVM
        };
    }
    // 需要重复创建，因为每个 extension 都需要一个独立的 translate
    translate = createTranslate(vm);

    // 需要创建新的 Scratch Object
    // 否则所有 extension 都共享一个 Scratch 对象 → 共享同一个 translate
    global.Scratch = {
        ArgumentType,
        BlockType,
        TargetType,
        Cast,
        Color,
        translate,
        extensions: {
            unsandboxed: true,
            register: registerExt
        },
        vm: openVM,
        runtime: openVM.runtime,
        renderer: openVM.runtime.renderer
    };
};

const createdScriptLoader = ({url, onSuccess, onError}) => {
    if (!url) {
        return onError('remote extension url is null');
    }
    const exist = document.getElementById(url);
    if (exist) {
        log.warn(`${url} remote extension script already loaded before`);
        exist.successCallBack.push(onSuccess);
        exist.failedCallBack.push(onError);
        return exist;
    }

    const script = document.createElement('script');
    script.src = `${url + (url.includes('?') ? '&' : '?')}t=${Date.now()}`;
    script.id = url;
    script.defer = true;
    script.type = 'module';

    script.successCallBack = [onSuccess];
    script.failedCallBack = [onError];

    let scriptError = null;
    const logError = e => {
        scriptError = e;
    };
    global.addEventListener('error', logError);

    const removeScript = () => {
        global.removeEventListener('error', logError);
        document.body.removeChild(script);
    };

    script.onload = () => {
        if (scriptError) {
            script.failedCallBack.forEach(cb => cb?.(scriptError, url));
            script.failedCallBack = [];
        } else {
            script.successCallBack.forEach(cb => cb(url));
            script.successCallBack = [];
        }
        removeScript();
    };

    script.onerror = e => {
        script.failedCallBack.forEach(cb => cb?.(e, url));
        script.failedCallBack = [];
        removeScript();
    };

    try {
        document.body.append(script);
    } catch (error) {
        removeScript();
        log.error('load custom extension error:', error);
    }
    return script;
};

// Because setupScratchAPI requires messing with global state (global.Scratch),
// only let one extension load at a time.
const limiter = new AsyncLimiter(async (vm, callback) => {
    setupScratchAPI(vm);
    try {
        const res = await callback();
        return res;
    } finally {
        clearScratchAPI();
    }
}, 1);
/**
 * Sets up the Scratch API and ensures that only one is executing at a time to prevent race conditions.
 * @async
 * @param {Object} vm - The virtual machine to use.
 * @param {() => Promise} callback - Async callback to execute with Scratch API.
 * @returns {Promise} - The promise that resolves when the callback completes.
 */
const withScratchAPI = async (vm, callback) => limiter.do(vm, callback);

module.exports = {withScratchAPI, createdScriptLoader};
