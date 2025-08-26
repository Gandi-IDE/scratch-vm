let _TextEncoder;
if (typeof TextEncoder === 'undefined') {
    _TextEncoder = require('text-encoding').TextEncoder;
} else {
    _TextEncoder = TextEncoder;
}
const EventEmitter = require('events');
const JSZip = require('@turbowarp/jszip');

const Buffer = require('buffer').Buffer;
const centralDispatch = require('./dispatch/central-dispatch');
const ExtensionManager = require('./extension-support/extension-manager');
const log = require('./util/log');
const MathUtil = require('./util/math-util');
const Runtime = require('./engine/runtime');
const RenderedTarget = require('./sprites/rendered-target');
const Sprite = require('./sprites/sprite');
const StringUtil = require('./util/string-util');
const formatMessage = require('format-message');

const Variable = require('./engine/variable');
const newBlockIds = require('./util/new-block-ids');

const {loadCostume} = require('./import/load-costume.js');
const {loadSound} = require('./import/load-sound.js');
const {
    serializeSounds,
    serializeCostumes
} = require('./serialization/serialize-assets');
const {loadGandiAsset} = require('./import/gandi-load-asset');
const generateUid = require('./util/uid');
const mutationAdapter = require('./engine/mutation-adapter.js');
const adapter = require('./engine/adapter.js');

require('canvas-toBlob');
const {exportCostume} = require('./serialization/tw-costume-import-export');
const Base64Util = require('./util/base64-util');

const RESERVED_NAMES = ['_mouse_', '_stage_', '_edge_', '_myself_', '_random_'];

const CORE_EXTENSIONS = [
    // 'motion',
    // 'looks',
    // 'sound',
    // 'events',
    // 'control',
    // 'sensing',
    // 'operators',
    // 'variables',
    // 'myBlocks'
];

// Disable missing translation warnings in console
formatMessage.setup({
    missingTranslation: 'ignore'
});

const createRuntimeService = runtime => {
    const service = {};
    service._refreshExtensionPrimitives =
        runtime._refreshExtensionPrimitives.bind(runtime);
    service._registerExtensionPrimitives =
        runtime._registerExtensionPrimitives.bind(runtime);
    return service;
};

/**
 * @typedef {object} Progress - Information about the loading progress
 * @property {number} total - The total number of loaded things
 * @property {number} loaded - The number of loads completed
 */

/**
 * Handles connections between blocks, stage, and extensions.
 * @constructor
 */
class VirtualMachine extends EventEmitter {
    static get FIND_PYTHON_CODE () {
        return 'FIND_PYTHON_CODE';
    }

    constructor () {
        super();

        /**
         * VM runtime, to store blocks, I/O devices, sprites/targets, etc.
         * @type {!Runtime}
         */
        this.runtime = new Runtime();
        centralDispatch
            .setService('runtime', createRuntimeService(this.runtime))
            .catch(e => {
                log.error(
                    `Failed to register runtime service: ${JSON.stringify(e)}`
                );
            });

        /**
         * The "currently editing"/selected target ID for the VM.
         * Block events from any Blockly workspace are routed to this target.
         * @type {Target}
         */
        this.editingTarget = null;

        /**
         * This variable indicates whether asynchronous loading of project resource files is supported
         */
        this.asyncLoadingProjectAssetsSupported = false;

        /**
         * The currently dragging target, for redirecting IO data.
         * @type {Target}
         */
        this._dragTarget = null;

        /**
         * The current project resource loading progress.
         * @type {Progress}
         */
        this._assetsLoadProgress = null;

        // Runtime emits are passed along as VM emits.
        this.runtime.on(Runtime.SCRIPT_GLOW_ON, glowData => {
            this.emit(Runtime.SCRIPT_GLOW_ON, glowData);
        });
        this.runtime.on(Runtime.SCRIPT_GLOW_OFF, glowData => {
            this.emit(Runtime.SCRIPT_GLOW_OFF, glowData);
        });
        this.runtime.on(Runtime.PROJECT_ASSETS_ASYNC_LOAD_DONE, () => {
            this.emit(Runtime.PROJECT_ASSETS_ASYNC_LOAD_DONE);
        });
        this.runtime.on(Runtime.BLOCK_GLOW_ON, glowData => {
            this.emit(Runtime.BLOCK_GLOW_ON, glowData);
        });
        this.runtime.on(Runtime.BLOCK_GLOW_OFF, glowData => {
            this.emit(Runtime.BLOCK_GLOW_OFF, glowData);
        });
        this.runtime.on(Runtime.PROJECT_START, () => {
            this.emit(Runtime.PROJECT_START);
        });
        this.runtime.on(Runtime.PROJECT_LOADED, () => {
            this.emit(Runtime.PROJECT_LOADED);
        });
        this.runtime.on(Runtime.PROJECT_RUN_START, () => {
            this.emit(Runtime.PROJECT_RUN_START);
        });
        this.runtime.on(Runtime.PROJECT_RUN_STOP, () => {
            this.emit(Runtime.PROJECT_RUN_STOP);
        });
        this.runtime.on(Runtime.PROJECT_RUN_PAUSE, status => {
            this.emit(Runtime.PROJECT_RUN_PAUSE, status);
        });
        this.runtime.on(Runtime.PROJECT_RUN_RESUME, () => {
            this.emit(Runtime.PROJECT_RUN_RESUME);
        });
        this.runtime.on(Runtime.PROJECT_CHANGED, () => {
            this.emit(Runtime.PROJECT_CHANGED);
        });
        this.runtime.on(Runtime.MOBILE_BUTTONS_VISIBLE_CHANGED, value => {
            this.emit(Runtime.MOBILE_BUTTONS_VISIBLE_CHANGED, value);
        });
        this.runtime.on(Runtime.TARGET_BLOCKS_CHANGED, (targetId, blocks, ext) => {
            this.emit(Runtime.TARGET_BLOCKS_CHANGED, targetId, blocks, ext);
        });
        this.runtime.on(Runtime.TARGET_COMMENTS_CHANGED, (targetId, data) => {
            this.emit(Runtime.TARGET_COMMENTS_CHANGED, targetId, data);
        });
        this.runtime.on(Runtime.TARGET_FRAMES_CHANGED, (targetId, data) => {
            this.emit(Runtime.TARGET_FRAMES_CHANGED, targetId, data);
        });
        this.runtime.on(Runtime.TARGET_COSTUME_CHANGED, (id, data) => {
            this.emit(Runtime.TARGET_COSTUME_CHANGED, id, data);
        });
        this.runtime.on(Runtime.TARGET_CURRENT_COSTUME_CHANGED, index => {
            this.emit(Runtime.TARGET_CURRENT_COSTUME_CHANGED, index);
        });
        this.runtime.on(Runtime.TARGET_VARIABLES_CHANGED, (id, data) => {
            this.emit(Runtime.TARGET_VARIABLES_CHANGED, id, data);
        });
        this.runtime.on(Runtime.MONITORS_CHANGED, data => {
            this.emit(Runtime.MONITORS_CHANGED, data);
        });
        this.runtime.on(Runtime.TARGETS_INDEX_CHANGED, data => {
            this.emit(Runtime.TARGETS_INDEX_CHANGED, data);
        });
        this.runtime.on(Runtime.TARGET_SIMPLE_PROPERTY_CHANGED, data => {
            this.emit(Runtime.TARGET_SIMPLE_PROPERTY_CHANGED, data);
        });
        this.runtime.on(Runtime.VISUAL_REPORT, visualReport => {
            this.emit(Runtime.VISUAL_REPORT, visualReport);
        });
        this.runtime.on(Runtime.TARGETS_UPDATE, emitProjectChanged => {
            this.emitTargetsUpdate(emitProjectChanged);
        });
        this.runtime.on(Runtime.MONITORS_UPDATE, monitorList => {
            this.emit(Runtime.MONITORS_UPDATE, monitorList);
        });
        this.runtime.on(Runtime.SOUNDS_CHANGED, (targetId, data) => {
            this.emit(Runtime.SOUNDS_CHANGED, targetId, data);
        });
        this.runtime.on(Runtime.BLOCK_DRAG_UPDATE, areBlocksOverGui => {
            this.emit(Runtime.BLOCK_DRAG_UPDATE, areBlocksOverGui);
        });
        this.runtime.on(Runtime.FRAME_DRAG_UPDATE, areBlocksOverGui => {
            this.emit(Runtime.FRAME_DRAG_UPDATE, areBlocksOverGui);
        });
        this.runtime.on(Runtime.BLOCK_DRAG_END, (blocks, topBlockId, newBatchElements) => {
            this.emit(Runtime.BLOCK_DRAG_END, blocks, topBlockId, newBatchElements);
        });
        this.runtime.on(Runtime.FRAME_DRAG_END, (frame, frameId, newBatchElements) => {
            this.emit(Runtime.FRAME_DRAG_END, frame, frameId, newBatchElements);
        });
        this.runtime.on(Runtime.EXTENSION_ADDED, categoryInfo => {
            this.emit(Runtime.EXTENSION_ADDED, categoryInfo);
        });
        this.runtime.on(Runtime.EXTENSION_DELETED, id => {
            this.emit(Runtime.EXTENSION_DELETED, id);
        });
        this.runtime.on(
            Runtime.EXTENSION_FIELD_ADDED,
            (fieldName, fieldImplementation) => {
                this.emit(
                    Runtime.EXTENSION_FIELD_ADDED,
                    fieldName,
                    fieldImplementation
                );
            }
        );
        this.runtime.on(Runtime.BLOCKSINFO_UPDATE, categoryInfo => {
            this.emit(Runtime.BLOCKSINFO_UPDATE, categoryInfo);
        });
        this.runtime.on(Runtime.BLOCKS_NEED_UPDATE, () => {
            this.emitWorkspaceUpdate();
        });
        this.runtime.on(Runtime.CUSTOM_BLOCK_ARGUMENTS_LENGTH_CHANGED, () => {
            this.emit(Runtime.CUSTOM_BLOCK_ARGUMENTS_LENGTH_CHANGED);
        });
        this.runtime.on(Runtime.TOOLBOX_EXTENSIONS_NEED_UPDATE, () => {
            this.extensionManager.refreshBlocks();
        });
        this.runtime.on(Runtime.PERIPHERAL_LIST_UPDATE, info => {
            this.emit(Runtime.PERIPHERAL_LIST_UPDATE, info);
        });
        this.runtime.on(Runtime.USER_PICKED_PERIPHERAL, info => {
            this.emit(Runtime.USER_PICKED_PERIPHERAL, info);
        });
        this.runtime.on(Runtime.PERIPHERAL_CONNECTED, () =>
            this.emit(Runtime.PERIPHERAL_CONNECTED)
        );
        this.runtime.on(Runtime.PERIPHERAL_REQUEST_ERROR, () =>
            this.emit(Runtime.PERIPHERAL_REQUEST_ERROR)
        );
        this.runtime.on(Runtime.PERIPHERAL_DISCONNECTED, () =>
            this.emit(Runtime.PERIPHERAL_DISCONNECTED)
        );
        this.runtime.on(Runtime.PERIPHERAL_CONNECTION_LOST_ERROR, data =>
            this.emit(Runtime.PERIPHERAL_CONNECTION_LOST_ERROR, data)
        );
        this.runtime.on(Runtime.PERIPHERAL_SCAN_TIMEOUT, () =>
            this.emit(Runtime.PERIPHERAL_SCAN_TIMEOUT)
        );
        this.runtime.on(Runtime.MIC_LISTENING, listening => {
            this.emit(Runtime.MIC_LISTENING, listening);
        });
        this.runtime.on(Runtime.EXTENSION_DATA_LOADING, listening => {
            this.emit(Runtime.EXTENSION_DATA_LOADING, listening);
        });
        this.runtime.on(Runtime.RUNTIME_STARTED, () => {
            this.emit(Runtime.RUNTIME_STARTED);
        });
        this.runtime.on(Runtime.RUNTIME_STOPPED, () => {
            this.emit(Runtime.RUNTIME_STOPPED);
        });
        this.runtime.on(Runtime.HAS_CLOUD_DATA_UPDATE, hasCloudData => {
            this.emit(Runtime.HAS_CLOUD_DATA_UPDATE, hasCloudData);
        });
        this.runtime.on(Runtime.RUNTIME_OPTIONS_CHANGED, runtimeOptions => {
            this.emit(Runtime.RUNTIME_OPTIONS_CHANGED, runtimeOptions);
        });
        this.runtime.on(Runtime.COMPILER_OPTIONS_CHANGED, compilerOptions => {
            this.emit(Runtime.COMPILER_OPTIONS_CHANGED, compilerOptions);
        });
        this.runtime.on(Runtime.FRAMERATE_CHANGED, framerate => {
            this.emit(Runtime.FRAMERATE_CHANGED, framerate);
        });
        this.runtime.on(Runtime.INTERPOLATION_CHANGED, framerate => {
            this.emit(Runtime.INTERPOLATION_CHANGED, framerate);
        });
        this.runtime.on(Runtime.STAGE_SIZE_CHANGED, (width, height) => {
            this.emit(Runtime.STAGE_SIZE_CHANGED, width, height);
        });
        this.runtime.on(Runtime.COMPILE_ERROR, (target, error) => {
            this.emit(Runtime.COMPILE_ERROR, target, error);
        });
        this.runtime.on(Runtime.TURBO_MODE_ON, (target, error) => {
            this.emit(Runtime.TURBO_MODE_ON, target, error);
        });
        this.runtime.on(Runtime.TURBO_MODE_OFF, (target, error) => {
            this.emit(Runtime.TURBO_MODE_OFF, target, error);
        });
        this.runtime.on(Runtime.CCWAPI_CHANGED, (target, error) => {
            this.emit(Runtime.CCWAPI_CHANGED, target, error);
        });
        this.runtime.on(Runtime.GANDI_WILD_EXTENSIONS_CHANGED, data => {
            this.emit(Runtime.GANDI_WILD_EXTENSIONS_CHANGED, data);

        });
        this.runtime.on(Runtime.GANDI_ASSET_UPDATE, ({data, type}) => {
            // For collaborative editing
            const {id, assetId, dataFormat, name, asset} = data;
            const md5ext = `${assetId}.${dataFormat}`;
            this.emit(Runtime.GANDI_ASSET_UPDATE, {data: {assetId, dataFormat, name, md5ext, asset, id}, type, id});

        });

        this.runtime.on(Runtime.GANDI_SPINE_UPDATE, data => {
            this.emit(Runtime.GANDI_SPINE_UPDATE, data);
        });
        this.runtime.on(Runtime.GANDI_CONFIGS_UPDATE, data => {
            this.emit(Runtime.GANDI_CONFIGS_UPDATE, data);
        });
        this.runtime.on(Runtime.GANDI_DYNAMIC_MENU_ITEMS_UPDATE, data => {
            this.emit(Runtime.GANDI_DYNAMIC_MENU_ITEMS_UPDATE, data);
        });
        this.runtime.on(Runtime.LOAD_ASSETS_PROGRESS, data => {
            if (data && Object.hasOwnProperty.call(data, 'total')) {
                const total = isNaN(data.total) ? 0 : Number(data.total);
                this._assetsLoadProgress = {total, loaded: 0};
                this.emit(Runtime.LOAD_ASSETS_PROGRESS, {...this._assetsLoadProgress});
            } else {
                const {total = 0, loaded = 0} = this._assetsLoadProgress || {};
                if (total > loaded) {
                    this._assetsLoadProgress.loaded++;
                    this.emit(Runtime.LOAD_ASSETS_PROGRESS, {...this._assetsLoadProgress});
                }
            }
        });
        this.runtime.on(Runtime.LOAD_ASSET_FAILED, info => {
            this.emit(Runtime.LOAD_ASSET_FAILED, info);
        });
        this.runtime.on(Runtime.ASSET_PROGRESS, (finished, total) => {
            this.emit(Runtime.ASSET_PROGRESS, finished, total);
        });

        this.extensionManager = new ExtensionManager(this);
        this.securityManager = this.extensionManager.securityManager;
        this.runtime.extensionManager = this.extensionManager;

        // Load core extensions
        for (const id of CORE_EXTENSIONS) {
            this.extensionManager.loadExtensionIdSync(id);
        }

        this.blockListener = this.blockListener.bind(this);
        this.frameListener = this.frameListener.bind(this);
        this.flyoutBlockListener = this.flyoutBlockListener.bind(this);
        this.monitorBlockListener = this.monitorBlockListener.bind(this);
        this.variableListener = this.variableListener.bind(this);

        /**
         * Export some internal classes for extensions.
         */
        this.exports = {
            Sprite,
            RenderedTarget,
            JSZip,

            i_will_not_ask_for_help_when_these_break: () => {
                console.warn('You are using unsupported APIs. WHEN your code breaks, do not expect help.');
                return ({
                    JSGenerator: require('./compiler/jsgen.js'),
                    IRGenerator: require('./compiler/irgen.js').IRGenerator,
                    ScriptTreeGenerator: require('./compiler/irgen.js').ScriptTreeGenerator,
                    Thread: require('./engine/thread.js'),
                    execute: require('./engine/execute.js')
                });
            }
        };
        this._projectProcessingUniqueId = 0;
    }

    /**
     * Start running the VM - do this before anything else.
     */
    start () {
        this.runtime.start();
    }

    /**
     * @deprecated Used by old versions of TurboWarp. Superceded by upstream's quit()
     */
    stop () {
        this.quit();
    }

    /**
     * Quit the VM, clearing any handles which might keep the process alive.
     * Do not use the runtime after calling this method. This method is meant for test shutdown.
     */
    quit () {
        this.runtime.quit();
    }

    /**
     * "Green flag" handler - start all threads starting with a green flag.
     */
    greenFlag () {
        this.runtime.greenFlag();
    }

    /**
     * Set whether the VM is in "turbo mode."
     * When true, loops don't yield to redraw.
     * @param {boolean} turboModeOn Whether turbo mode should be set.
     */
    setTurboMode (turboModeOn) {
        this.runtime.turboMode = !!turboModeOn;
        if (this.runtime.turboMode) {
            this.emit(Runtime.TURBO_MODE_ON);
        } else {
            this.emit(Runtime.TURBO_MODE_OFF);
        }
    }

    /**
     * Set whether the VM is in 2.0 "compatibility mode."
     * When true, ticks go at 2.0 speed (30 TPS).
     * @param {boolean} compatibilityModeOn Whether compatibility mode is set.
     */
    setCompatibilityMode (compatibilityModeOn) {
        this.runtime.setCompatibilityMode(!!compatibilityModeOn);
    }

    setFramerate (framerate) {
        this.runtime.setFramerate(framerate);
    }

    setInterpolation (interpolationEnabled) {
        this.runtime.setInterpolation(interpolationEnabled);
    }

    setRuntimeOptions (runtimeOptions) {
        this.runtime.setRuntimeOptions(runtimeOptions);
    }

    /**
     * ccw: Set ccw API to runtime support ccw block extensions
     * @param {*} ccwAPI ccw API
     */
    setCCWAPI (ccwAPI) {
        this.runtime.setCCWAPI(ccwAPI);
    }

    setCompilerOptions (compilerOptions) {
        this.runtime.setCompilerOptions(compilerOptions);
    }

    setIsPlayerOnly (isPlayerOnly) {
        this.runtime.setIsPlayerOnly(isPlayerOnly);
    }

    setStageSize (width, height) {
        this.runtime.setStageSize(width, height);
    }

    setInEditor (inEditor) {
        this.runtime.setInEditor(inEditor);
    }

    convertToPackagedRuntime () {
        this.runtime.convertToPackagedRuntime();
    }

    addAddonBlock (options) {
        this.runtime.addAddonBlock(options);
    }

    getAddonBlock (procedureCode) {
        return this.runtime.getAddonBlock(procedureCode);
    }

    storeProjectOptions () {
        this.runtime.storeProjectOptions();
        if (this.editingTarget.isStage) {
            this.emitWorkspaceUpdate();
        }
    }

    enableDebug () {
        this.runtime.enableDebug();
        return 'enabled debug mode';
    }

    handleExtensionButtonPress (button) {
        this.runtime.handleExtensionButtonPress(button);
    }

    /**
     * Stop all threads and running activities.
     */
    stopAll () {
        this.runtime.stopAll();
    }

    // powered by xigua start
    disposeAll () {
        this.stopAll();
        this.runtime.disposeAll();
        this.editingTarget = null;
        this.extensionManager.disposeExtensionServices();
    }
    // powered by xigua end

    /**
     * Clear out current running project data.
     */
    clear () {
        this.runtime.dispose();
        this.editingTarget = null;
        this.emitTargetsUpdate(false /* Don't emit project change */);

        // clear extensions
        this.extensionManager.clearLoadedExtensions();
    }

    /**
     * Get data for playground. Data comes back in an emitted event.
     */
    getPlaygroundData () {
        const instance = this;
        // Only send back thread data for the current editingTarget.
        const threadData = this.runtime.threads.filter(
            thread => thread.target === instance.editingTarget
        );
        // Remove the target key, since it's a circular reference.
        const filteredThreadData = JSON.stringify(
            threadData,
            (key, value) => {
                if (key === 'target' || key === 'blockContainer' || key.startsWith('_')) return;
                return value;
            },
            2
        );
        this.emit('playgroundData', {
            blocks: this.editingTarget.blocks,
            threads: filteredThreadData
        });
    }

    /**
     * Post I/O data to the virtual devices.
     * @param {?string} device Name of virtual I/O device.
     * @param {object} data Any data object to post to the I/O device.
     */
    postIOData (device, data) {
        if (this.runtime.ioDevices[device]) {
            this.runtime.ioDevices[device].postData(data);
        }
    }

    setVideoProvider (videoProvider) {
        this.runtime.ioDevices.video.setProvider(videoProvider);
    }

    setCloudProvider (cloudProvider) {
        this.runtime.ioDevices.cloud.setProvider(cloudProvider);
    }

    /**
     * Tell the specified extension to scan for a peripheral.
     * @param {string} extensionId - the id of the extension.
     */
    scanForPeripheral (extensionId) {
        this.runtime.scanForPeripheral(extensionId);
    }

    /**
     * Connect to the extension's specified peripheral.
     * @param {string} extensionId - the id of the extension.
     * @param {number} peripheralId - the id of the peripheral.
     */
    connectPeripheral (extensionId, peripheralId) {
        this.runtime.connectPeripheral(extensionId, peripheralId);
    }

    /**
     * Disconnect from the extension's connected peripheral.
     * @param {string} extensionId - the id of the extension.
     */
    disconnectPeripheral (extensionId) {
        this.runtime.disconnectPeripheral(extensionId);
    }

    /**
     * Returns whether the extension has a currently connected peripheral.
     * @param {string} extensionId - the id of the extension.
     * @return {boolean} - whether the extension has a connected peripheral.
     */
    getPeripheralIsConnected (extensionId) {
        return this.runtime.getPeripheralIsConnected(extensionId);
    }

    /**
     * Load a Scratch project from a .sb, .sb2, .sb3 or json string.
     * @param {string | object} input A json string, object, or ArrayBuffer representing the project to load.
     * @param {?function} jsonFormatter A function to format the project json.
     * @return {!Promise} Promise that resolves after targets are installed.
     */
    loadProject (input, jsonFormatter, options) {
        // If assets are being loaded non-blockingly, they can all be aborted at once.
        if (this.runtime.asyncLoadingProjectAssets) {
            this.runtime.disposeFireWaitingLoadCallbackQueue();
        }
        // Support non-blocking loading of project assets.
        if (this.asyncLoadingProjectAssetsSupported) {
            this.runtime.asyncLoadingProjectAssets = true;
            this.runtime.isLoadProjectAssetsNonBlocking = true;
        }
        const _projectProcessingUniqueId = (this._projectProcessingUniqueId =
            Math.random());
        if (
            typeof input === 'object' &&
            !(input instanceof ArrayBuffer) &&
            !ArrayBuffer.isView(input)
        ) {
            // If the input is an object and not any ArrayBuffer
            // or an ArrayBuffer view (this includes all typed arrays and DataViews)
            // turn the object into a JSON string, because we suspect
            // this is a project.json as an object
            // validate expects a string or buffer as input
            // TODO not sure if we need to check that it also isn't a data view
            input = JSON.stringify(input);
        }

        const validationPromise = new Promise((resolve, reject) => {
            const validate = require('scratch-parser');
            // The second argument of false below indicates to the validator that the
            // input should be parsed/validated as an entire project (and not a single sprite)
            validate(input, false, (error, res) => {
                if (error) {
                    return reject(error);
                }
                resolve(res);
            });
        }).catch(error => {
            const {
                SB1File,
                ValidationError
            } = require('scratch-sb1-converter');

            try {
                const sb1 = new SB1File(input);
                const json = sb1.json;
                json.projectVersion = 2;
                return Promise.resolve([json, sb1.zip]);
            } catch (sb1Error) {
                if (
                    sb1Error instanceof ValidationError ||
                    `${sb1Error}`.includes(
                        'Non-ascii character in FixedAsciiString'
                    )
                ) {
                    // The input does not validate as a Scratch 1 file.
                } else {
                    // The project appears to be a Scratch 1 file but it
                    // could not be successfully translated into a Scratch 2
                    // project.
                    return Promise.reject(sb1Error);
                }
            }
            // Throw original error since the input does not appear to be
            // an SB1File.
            return Promise.reject(error);
        });

        return (
            validationPromise
                // powered by xigua 西瓜特色sb3，只包含了project.json文件，这里为了处理无法从zip中找到资源的问题，假装这个sb3是一个json而已
                .then(validatedInput => {
                    // 清理之前的python代码
                    this.emit(VirtualMachine.FIND_PYTHON_CODE, '');
                    let [json, zip] = validatedInput;
                    if (
                        zip &&
                        zip.files &&
                        // 这里存在两种情况，scratch-python课程sb3里会多包含一个main.py文件
                        ((Object.keys(zip.files).length === 1 &&
                            Object.hasOwnProperty.call(zip.files, 'project.json')) ||
                        (Object.keys(zip.files).length === 2 &&
                            Object.hasOwnProperty.call(zip.files, 'project.json') &&
                            Object.hasOwnProperty.call(zip.files, 'main.py')))
                    ) {
                        if (Object.hasOwnProperty.call(zip.files, 'main.py')) {
                            zip.files['main.py']
                                .async('string')
                                .then(pythonCode => {
                                    this.emit(
                                        VirtualMachine.FIND_PYTHON_CODE,
                                        pythonCode
                                    );
                                });
                        }

                        zip = null;
                    }
                    if (typeof jsonFormatter === 'function') {
                        jsonFormatter(json);
                    }
                    return this.deserializeProject(
                        json,
                        zip,
                        _projectProcessingUniqueId,
                        options,
                    );
                })
                .then(() => this.runtime.handleProjectLoaded())
                .then(() => {
                    this.runtime.isLoadProjectAssetsNonBlocking = false;
                    this.runtime.fireWaitingLoadCallbackQueue();
                })
                .catch(error => {
                    // Intentionally rejecting here (want errors to be handled by caller)
                    if (Object.prototype.hasOwnProperty.call(error, 'validationError')) {
                        return Promise.reject(JSON.stringify(error));
                    }
                    return Promise.reject(error);
                })
        );
    }

    /**
     * Load a project from the Scratch web site, by ID.
     * @param {string} id - the ID of the project to download, as a string.
     */
    downloadProjectId (id) {
        const storage = this.runtime.storage;
        if (!storage) {
            log.error('No storage module present; cannot load project: ', id);
            return;
        }
        const vm = this;
        const promise = storage.load(storage.AssetType.Project, id);
        promise.then(projectAsset => {
            if (!projectAsset) {
                log.error(`Failed to fetch project with id: ${id}`);
                return null;
            }
            return vm.loadProject(projectAsset.data);
        });
    }

    /**
     * @returns {JSZip} JSZip zip object representing the sb3.
     */
    _saveProjectZip () {
        const projectJson = this.toJSON();

        // TODO want to eventually move zip creation out of here, and perhaps
        // into scratch-storage
        const zip = new JSZip();

        // Put everything in a zip file
        zip.file('project.json', projectJson);
        this._addFileDescsToZip(this.serializeAssets(), zip);

        return zip;
    }

    /**
     * @param {JSZip.OutputType} [type] JSZip output type. Defaults to 'blob' for Scratch compatibility.
     * @returns {Promise<unknown>} Compressed sb3 file in a type determined by the type argument.
     */
    saveProjectSb3 (type) {
        return this._saveProjectZip().generateAsync({
            type: type || 'blob',
            mimeType: 'application/x.scratch.sb3',
            compression: 'DEFLATE'
        });
    }

    /**
     * @param {JSZip.OutputType} [type] JSZip output type. Defaults to 'arraybuffer'.
     * @returns {StreamHelper} JSZip StreamHelper object generating the compressed sb3.
     * See: https://stuk.github.io/jszip/documentation/api_streamhelper.html
     */
    saveProjectSb3Stream (type) {
        return this._saveProjectZip().generateInternalStream({
            type: type || 'arraybuffer',
            mimeType: 'application/x.scratch.sb3',
            compression: 'DEFLATE'
        });
    }

    /**
     * tw: Serialize the project into a map of files without actually zipping the project.
     * The buffers returned are the exact same ones used internally, not copies. Avoid directly
     * manipulating them (except project.json, which is created by this function).
     * @returns {Record<string, Uint8Array>} Map of file name to the raw data for that file.
     */
    saveProjectSb3DontZip () {
        const projectJson = this.toJSON();

        const files = {
            'project.json': new _TextEncoder().encode(projectJson)
        };
        for (const fileDesc of this.serializeAssets()) {
            files[fileDesc.fileName] = fileDesc.fileContent;
        }

        return files;
    }

    /**
     * Serialize project.
     * @param {object} whetherSerialize
     * @param {boolean} whetherSerialize.isSerializeSounds whether to serialize sound
     * @param {boolean} whetherSerialize.isSerializeCostumes whether to serialize costumes
     * @param {boolean} whetherSerialize.isSerializeJson whether to serialize json
     * @returns {Object} Serialized state of the runtime.
     */
    serializeProject ({isSerializeSounds = false, isSerializeCostumes = false, isSerializeJson = false} = {}) {
        return {
            ...(isSerializeSounds && {soundDescs: serializeSounds(this.runtime)}),
            ...(isSerializeCostumes && {costumeDescs: serializeCostumes(this.runtime)}),
            ...(isSerializeJson && {projectJson: this.toJSON()})
        };
    }

    /**
     * @type {Array<object>} Array of all assets currently in the runtime
     */
    get assets () {
        const gandiAssets = this.runtime.gandi ?
            this.runtime.gandi.assets.map(obj => obj.asset).filter(obj => obj) : [];

        const allAssets = this.runtime.targets.reduce(
            (acc, target) =>
                acc
                    .concat(target.sprite.sounds.filter(sound => !sound.isRuntimeAsyncLoad).map(sound => sound.asset))
                    .concat(
                        target.sprite.costumes.filter(costume => !costume.isRuntimeAsyncLoad).map(costume => costume.asset)
                    ),
            []
        ).concat(gandiAssets);
        return allAssets;

        // TODO: we don't support custom fonts yet
        // const fonts = this.runtime.fontManager.serializeAssets();
        // return allAssets.concat(fonts);
    }

    generateUid () {
        return generateUid();
    }

    getSb3Utils () {
        const sb3 = require('./serialization/sb3');
        return sb3;
    }

    createGandiAssetFile (name, assetType, data = '') {
        const fileName = `${name}.${assetType.runtimeFormat}`;
        if (this.getGandiAssetFile(fileName)) {
            throw new Error(`Asset with name ${fileName} already exists`);
        }
        const storage = this.runtime.storage;
        const obj = {name};
        obj.dataFormat = assetType.runtimeFormat;
        obj.asset = storage.createAsset(
            assetType,
            obj.dataFormat,
            new _TextEncoder().encode(data),
            null,
            true // generate md5
        );
        obj.assetType = assetType;
        obj.id = generateUid(); // unique id for this asset, used in cloud project
        obj.assetId = obj.asset.assetId;
        obj.md5 = `${obj.assetId}.${obj.dataFormat}`;

        this.runtime.gandi.assets.push(obj);
        this.emitGandiAssetsUpdate({type: 'add', data: obj});
    }

    getGandiAssetsList (typesArray) {
        return this.runtime.getGandiAssetsList(typesArray);
    }

    getGandiAssetContent (fileName) {
        return this.runtime.getGandiAssetContent(fileName);
    }

    getGandiAssetsFileList (type) {
        return this.runtime.getGandiAssetsFileList(type);
    }

    getGandiAssetFile (fileName) {
        return this.runtime.getGandiAssetFile(fileName);
    }

    getGandiAssetById (id) {
        return this.runtime.getGandiAssetById(id);
    }

    getGandiAssetIndexAndFileById (id) {
        for (let index = 0; index < this.runtime.gandi.assets.length; index++) {
            const file = this.runtime.gandi.assets[index];
            if (file.id === id) {
                return {file, index};
            }
        }
        return {file: null, index: -1};
    }

    /**
     * @param {string} targetId Optional ID of target to export
     * @returns {Array<{fileName: string; fileContent: Uint8Array;}} list of file descs
     */
    serializeAssets (targetId) {
        const costumeDescs = serializeCostumes(this.runtime, targetId);
        const soundDescs = serializeSounds(this.runtime, targetId);
        const fontDescs = this.runtime.fontManager.serializeAssets().map(asset => ({
            fileName: `${asset.assetId}.${asset.dataFormat}`,
            fileContent: asset.data
        }));
        return [
            ...costumeDescs,
            ...soundDescs,
            ...fontDescs
        ];
    }

    _addFileDescsToZip (fileDescs, zip) {
        // TODO: sort files, smallest first
        for (let i = 0; i < fileDescs.length; i++) {
            const currFileDesc = fileDescs[i];
            zip.file(currFileDesc.fileName, currFileDesc.fileContent);
        }
    }

    /**
     * Exports a sprite in the sprite3 format.
     * @param {string} targetId ID of the target to export
     * @param {string=} optZipType Optional type that the resulting
     * zip should be outputted in. Options are: base64, binarystring,
     * array, uint8array, arraybuffer, blob, or nodebuffer. Defaults to
     * blob if argument not provided.
     * See https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html#type-option
     * for more information about these options.
     * @return {object} A generated zip of the sprite and its assets in the format
     * specified by optZipType or blob by default.
     */
    exportSprite (targetId, optZipType) {
        const spriteJson = this.toJSON(targetId);

        const zip = new JSZip();
        zip.file('sprite.json', spriteJson);
        this._addFileDescsToZip(this.serializeAssets(targetId), zip);

        return zip.generateAsync({
            type: typeof optZipType === 'string' ? optZipType : 'blob',
            mimeType: 'application/x.scratch.sprite3',
            compression: 'DEFLATE',
            compressionOptions: {
                level: 6
            }
        });
    }

    /**
     * Export project or sprite as a Scratch 3.0 JSON representation.
     * @param {string=} optTargetId - Optional id of a sprite to serialize
     * @param {*} serializationOptions Options to pass to the serializer
     * @return {string} Serialized state of the runtime.
     */
    toJSON (optTargetId, serializationOptions) {
        const sb3 = require('./serialization/sb3');
        return StringUtil.stringify(sb3.serialize(this.runtime, optTargetId, serializationOptions));
    }
    /**
     * Serialize a sprite in the sprite3 format.
     * @param {string} targetId ID of the target to export
     * @param {?Boolean} saveVarId Whether to save the variable ID or not
     * @returns {Object} Serialized state of the runtime.
     */
    serializeSprite (targetId, saveVarId) {
        const sb3 = require('./serialization/sb3');
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            return sb3.serializeTarget(target.toJSON(), new Set(), saveVarId);
        }
    }

    /**
     * Serialize sprite assets for gui
     * @param {string} targetId ID of the target to export
     * @returns {Object} sound & costume & spriteJson result of serialize
     */
    serializeSpriteAssets (targetId) {
        const sb3 = require('./serialization/sb3');
        const soundDescs = serializeSounds(this.runtime, targetId);
        const costumeDescs = serializeCostumes(this.runtime, targetId);
        const spriteJson = StringUtil.stringify(
            sb3.serialize(this.runtime, targetId)
        );
        return {
            soundDescs,
            costumeDescs,
            spriteJson
        };
    }

    // TODO do we still need this function? Keeping it here so as not to introduce
    // a breaking change.
    /**
     * Load a project from a Scratch JSON representation.
     * @param {string} json JSON string representing a project.
     * @returns {Promise} Promise that resolves after the project has loaded
     */
    fromJSON (json) {
        log.warn('fromJSON is now just a wrapper around loadProject, please use that function instead.');
        return this.loadProject(json);
    }

    /**
     * Load a project from a Scratch JSON representation.
     * @param {string} projectJSON JSON string representing a project.
     * @param {?JSZip} zip Optional zipped project containing assets to be loaded.
     * @param {number} _projectProcessingUniqueId 加载project的Id
     * @returns {Promise} Promise that resolves after the project has loaded
     */
    deserializeProject (projectJSON, zip, _projectProcessingUniqueId, options) {
        // Clear the current runtime
        this.clear();

        this.emit(Runtime.START_DESERIALIZE_PROJECT, projectJSON);

        if (typeof performance !== 'undefined') {
            performance.mark('scratch-vm-deserialize-start');
        }
        const runtime = this.runtime;
        const deserializePromise = function () {
            const projectVersion = projectJSON.projectVersion;
            if (projectVersion === 2) {
                const sb2 = require('./serialization/sb2');
                return sb2.deserialize(projectJSON, runtime, false, zip);
            }
            if (projectVersion === 3) {
                // Ensure that there is at least one sprite in the project.
                if (projectJSON.targets.length === 0) {
                    return Promise.reject(new Error(
                        'Project deserialization failed because there are no sprite in the project.'
                    ));
                }
                const sb3 = require('./serialization/sb3');
                return sb3.deserialize(projectJSON, runtime, zip);
            }
            // TODO: reject with an Error (possible breaking API change!)
            // eslint-disable-next-line prefer-promise-reject-errors
            return Promise.reject('Unable to verify Scratch Project version.');
        };
        return deserializePromise().then(({targets, extensions, gandi}) => {
            if (typeof performance !== 'undefined') {
                performance.mark('scratch-vm-deserialize-end');
                try {
                    performance.measure(
                        'scratch-vm-deserialize',
                        'scratch-vm-deserialize-start',
                        'scratch-vm-deserialize-end'
                    );
                } catch (e) {
                    // performance.measure() will throw an error if the start deserialize
                    // marker was removed from memory before we finished deserializing
                    // the project. We've seen this happen a couple times when loading
                    // very large projects.
                    log.error(e);
                }
            }
            return this.installTargets(
                targets,
                extensions,
                gandi,
                true,
                _projectProcessingUniqueId,
                false,
                options,
            );
        });
    }

    /**
     * Install `deserialize` results: zero or more targets after the extensions (if any) used by those targets.
     * @param {Array.<Target>} targets - the targets to be installed
     * @param {ImportedExtensionsInfo} extensions - metadata about extensions used by these targets
     * @param {Gandi} gandiObject - the gandi Object to be merged
     * @param {boolean} wholeProject - set to true if installing a whole project, as opposed to a single sprite.
     * @param {number} _projectProcessingUniqueId 加载project的Id
     * @param {boolean} isRemoteOperation - set to true if this is a remote operation
     * @returns {Promise<{addedTargets:Target[], addedGandiObject:Gandi}>} resolved once targets and Gandi object have been installed
     */
    async installTargets (
        targets,
        extensions,
        gandiObject,
        wholeProject,
        _projectProcessingUniqueId,
        isRemoteOperation,
        options,
    ) {
        await this.extensionManager.allAsyncExtensionsLoaded();
        const addedGandiObject = this.runtime.gandi.merge(gandiObject);
        const extensionPromises = [];
        // 可选的确认非官方扩展安装回调
        // 在加载扩展前，收集即将加载的非官方扩展信息并等待确认
        const confirmExtensionsCallBack = options?.confirmExtensionsCallBack;
        if (confirmExtensionsCallBack) {
            /**
             * @type {[{id: string; url?: string}]}
             */
            const extInfo = [];
            extensions.extensionIDs.forEach(extensionID => {
                // 跳过已加载
                if (this.extensionManager.isExtensionLoaded(extensionID)) return;
                // 跳过 builtin
                if (this.extensionManager.isBuiltinExtension(extensionID)) return;
                // 检查是否记录了URL
                let url = extensions.extensionURLs.get(extensionID);
                if (!url) {
                    // 检查 wildExtensions 是否有记录
                    url = this.runtime.gandi?.wildExtensions?.[extensionID]?.url;
                }
                // 记录了 URL
                if (url) {
                    extInfo.push({id: extensionID, url});
                    return;
                }
                // 跳过官方扩展
                if (this.extensionManager._officialExtensionInfo[extensionID]) return;
                // 剩余情况 - 非官方扩展ID
                extInfo.push({id: extensionID});
            });
            if (extInfo.length > 0) {
                // 等待确认
                await confirmExtensionsCallBack(extInfo);
            }
        }
        extensions.extensionIDs.forEach(extensionID => {
            if (!this.extensionManager.isExtensionLoaded(extensionID)) {
                let extensionURL = extensionID;
                if (!this.extensionManager.isBuiltinExtension(extensionID) && extensions.extensionURLs.get(extensionID)) {
                    extensionURL = extensions.extensionURLs.get(extensionID);
                }
                extensionPromises.push(
                    this.extensionManager.loadExtensionURL(extensionURL)
                );
            }
        });

        targets = targets.filter(target => !!target);

        if (
            _projectProcessingUniqueId &&
            this._projectProcessingUniqueId !== _projectProcessingUniqueId
        ) {
            return Promise.resolve();
        }

        return Promise.all(extensionPromises).then(() => {
            const addedTargets = targets.map(target => {
                this.runtime.addTarget(target);
                /** @type RenderedTarget */ target.updateAllDrawableProperties();
                // Ensure unique sprite name
                if (target.isSprite()) {
                    // Do not send the 'name changed' event here
                    // because the target has not completed installation yet.
                    this.renameSprite(target.id, target.getName(), false);
                }

                if (options?.extractProperties?.shouldMarkLockDeleteAbility){
                    target.extractProperties.lockDeleteAbility = true;
                }

                return target;
            });
            // Sort the executable targets by layerOrder.
            // Remove layerOrder property after use.
            this.runtime.executableTargets.sort(
                (a, b) => a.layerOrder - b.layerOrder
            );
            targets.forEach(target => {
                delete target.layerOrder;
            });

            if (!isRemoteOperation) {
                // Select the first target for editing, e.g., the first sprite.
                if (wholeProject && targets.length > 1) {
                    this.editingTarget = targets[1];
                } else {
                    this.editingTarget = targets[0];
                }
            }

            if (!wholeProject) {
                this.editingTarget.fixUpVariableReferences();
            }

            if (wholeProject) {
                this.runtime.parseProjectOptions();
            }

            // Update the VM user's knowledge of targets and blocks on the workspace.
            if (!isRemoteOperation) {
                this.emitTargetsUpdate(false /* Don't emit project change */);
                this.emitWorkspaceUpdate();
            }
            if (!isRemoteOperation) {
                this.runtime.setEditingTarget(this.editingTarget);
            }
            this.runtime.ioDevices.cloud.setStage(
                this.runtime.getTargetForStage()
            );
            // Facilitating subsequent operations to update these targets.
            return {addedTargets, addedGandiObject};
        });
    }

    /**
     * Add a sprite, this could be .sprite2 or .sprite3. Unpack and validate
     * such a file first.
     * @param {string | object} input A json string, object, or ArrayBuffer representing the project to load.
     * @param {?string} isRemoteOperation - set to true if this is a remote operation
     * @return {!Promise} Promise that resolves after targets are installed.
     */
    addSprite (input, isRemoteOperation) {
        const errorPrefix = 'Sprite Upload Error:';
        if (
            typeof input === 'object' &&
            !(input instanceof ArrayBuffer) &&
            !ArrayBuffer.isView(input)
        ) {
            // If the input is an object and not any ArrayBuffer
            // or an ArrayBuffer view (this includes all typed arrays and DataViews)
            // turn the object into a JSON string, because we suspect
            // this is a project.json as an object
            // validate expects a string or buffer as input
            // TODO not sure if we need to check that it also isn't a data view
            input = JSON.stringify(input);
        }

        const validationPromise = new Promise((resolve, reject) => {
            const validate = require('scratch-parser');
            // The second argument of true below indicates to the parser/validator
            // that the given input should be treated as a single sprite and not
            // an entire project
            validate(input, true, (error, res) => {
                if (error) return reject(error);
                resolve(res);
            });
        });

        return validationPromise
            .then(validatedInput => {
                const projectVersion = validatedInput[0].projectVersion;
                if (projectVersion === 2) {
                    return this._addSprite2(
                        validatedInput[0],
                        validatedInput[1]
                    );
                }
                if (projectVersion === 3) {
                    return this._addSprite3(
                        validatedInput[0],
                        validatedInput[1]
                    );
                }
                return Promise.reject(
                    `${errorPrefix} Unable to verify sprite version.`
                );
            })
            .then(({addedTargets: targets, addedGandiObject}) => {
                for (let index = 0; index < targets.length; index++) {
                    /** @type RenderedTarget */
                    const target = targets[index];
                    // Ensure unique costume name
                    target.sprite.costumes.forEach((costume, idx) => {
                        target.renameCostume(idx, costume.name, false);
                    });
                    // Ensure unique sound name
                    target.sprite.sounds.forEach((sound, idx) => {
                        target.renameSound(idx, sound.name, false);
                    });
                    // target.extractProperties.canDelete = false;
                }

                if (!isRemoteOperation) {
                    if (addedGandiObject) {
                        if (typeof addedGandiObject.wildExtensions === 'object') {
                            for (const [id, {url}] of Object.entries(addedGandiObject.wildExtensions)) {
                                this.runtime.gandi.addWildExtension({id, url});
                            }
                        }
                        if (Array.isArray(addedGandiObject.assets)) {
                            addedGandiObject.assets.forEach(obj => {
                                this.runtime.gandi.assets.push(obj);
                                this.runtime.emitGandiAssetsUpdate({type: 'add', data: obj});
                            });
                        }
                    }
                    if (targets) {
                        targets.forEach(target => {
                            this.emit('ADD_SPRITE', target.id);
                        });
                    }
                }
                this.runtime.emitProjectChanged();
            })
            .catch(error => {
                // Intentionally rejecting here (want errors to be handled by caller)
                if (Object.prototype.hasOwnProperty.call(error, 'validationError')) {
                    return Promise.reject(JSON.stringify(error));
                }
                // TODO: reject with an Error (possible breaking API change!)
                // eslint-disable-next-line prefer-promise-reject-errors
                return Promise.reject(`${errorPrefix} ${error}`);
            });
    }

    /**
     * Add a single sprite from the "Sprite2" (i.e., SB2 sprite) format.
     * @param {object} sprite Object representing 2.0 sprite to be added.
     * @param {?ArrayBuffer} zip Optional zip of assets being referenced by json
     * @param {?boolean} isRemoteOperation Whether to change editing target
     * @returns {Promise} Promise that resolves after the sprite is added
     */
    _addSprite2 (sprite, zip, isRemoteOperation) {
        // Validate & parse

        const sb2 = require('./serialization/sb2');
        return sb2
            .deserialize(sprite, this.runtime, true, zip)
            .then(({targets, extensions, gandi}) =>
                this.installTargets(targets, extensions, gandi, false, null, isRemoteOperation));
    }

    /**
     * Add a single sb3 sprite.
     * @param {object} sprite Object rperesenting 3.0 sprite to be added.
     * @param {?ArrayBuffer} zip Optional zip of assets being referenced by target json
     * @param {?boolean} isRemoteOperation Whether to change editing target
     * @returns {Promise} Promise that resolves after the sprite is added
     */
    _addSprite3 (sprite, zip, isRemoteOperation) {
        // Validate & parse
        const sb3 = require('./serialization/sb3');
        return sb3
            .deserialize(sprite, this.runtime, zip, true)
            .then(({targets, extensions, gandi}) =>
                this.installTargets(targets, extensions, gandi, false, null, isRemoteOperation)
            );
    }

    /**
     * Add a costume to the current editing target.
     * @param {string} md5ext - the MD5 and extension of the costume to be loaded.
     * @param {!object} costumeObject Object representing the costume.
     * @param {string} target - the target to add to.
     * @param {?int} index Index at which to add costume
     * @returns {?Promise} - a promise that resolves when the costume has been added
     */
    addCostumeFromRemote (md5ext, costumeObject, target, index) {
        if (target) {
            return loadCostume(
                md5ext,
                costumeObject,
                this.runtime,
                3
            ).then(() => {
                target.addCostume(costumeObject, index, true);
                target.setCostume(target.getCostumes().length - 1);
                this.runtime.emitProjectChanged();
            });
        }
        // If the target cannot be found by id, return a rejected promise
        return Promise.reject();
    }

    /**
     * Add a costume to the current editing target.
     * @param {string} md5ext - the MD5 and extension of the costume to be loaded.
     * @param {!object} costumeObject Object representing the costume.
     * @property {int} skinId - the ID of the costume's render skin, once installed.
     * @property {number} rotationCenterX - the X component of the costume's origin.
     * @property {number} rotationCenterY - the Y component of the costume's origin.
     * @property {number} [bitmapResolution] - the resolution scale for a bitmap costume.
     * @param {string} optTargetId - the id of the target to add to, if not the editing target.
     * @param {string} optVersion - if this is 2, load costume as sb2, otherwise load costume as sb3.
     * @param {boolean} isRemoteOperation Whether this is a remote operation.
     * @returns {?Promise} - a promise that resolves when the costume has been added
     */
    addCostume (md5ext, costumeObject, optTargetId, optVersion, isRemoteOperation) {
        const target = optTargetId ?
            this.runtime.getTargetById(optTargetId) :
            this.editingTarget;
        if (target) {
            return loadCostume(
                md5ext,
                costumeObject,
                this.runtime,
                optVersion
            ).then(() => {
                target.addCostume(costumeObject, null, isRemoteOperation);
                target.setCostume(target.getCostumeIndexById(costumeObject.id));
                this.runtime.emitProjectChanged();
            });
        }
        // If the target cannot be found by id, return a rejected promise
        // TODO: reject with an Error (possible breaking API change!)
        // eslint-disable-next-line prefer-promise-reject-errors
        return Promise.reject();
    }

    /**
     * Add a costume loaded from the library to the current editing target.
     * @param {string} md5ext - the MD5 and extension of the costume to be loaded.
     * @param {!object} costumeObject Object representing the costume.
     * @property {int} skinId - the ID of the costume's render skin, once installed.
     * @property {number} rotationCenterX - the X component of the costume's origin.
     * @property {number} rotationCenterY - the Y component of the costume's origin.
     * @property {number} [bitmapResolution] - the resolution scale for a bitmap costume.
     * @returns {?Promise} - a promise that resolves when the costume has been added
     */
    addCostumeFromLibrary (md5ext, costumeObject) {
        // TODO: reject with an Error (possible breaking API change!)
        // eslint-disable-next-line prefer-promise-reject-errors
        if (!this.editingTarget) return Promise.reject();
        return this.addCostume(
            md5ext,
            costumeObject,
            this.editingTarget.id,
            2 /* optVersion */
        );
    }

    /**
     * Duplicate the costume at the given index. Add it at that index + 1.
     * @param {!int} costumeIndex Index of costume to duplicate
     * @returns {?Promise} - a promise that resolves when the costume has been decoded and added
     */
    duplicateCostume (costumeIndex) {
        const originalCostume = this.editingTarget.getCostumes()[costumeIndex];
        const clone = Object.assign({}, originalCostume);
        clone.id = generateUid();
        const md5ext = `${clone.assetId}.${clone.dataFormat}`;
        return loadCostume(md5ext, clone, this.runtime).then(() => {
            clone.id = generateUid();
            this.editingTarget.addCostume(clone, costumeIndex + 1);
            this.editingTarget.setCostume(costumeIndex + 1);
            this.emitTargetsUpdate();
        });
    }

    /**
     * Duplicate the sound at the given index. Add it at that index + 1.
     * @param {!int} soundIndex Index of sound to duplicate
     * @returns {?Promise} - a promise that resolves when the sound has been decoded and added
     */
    duplicateSound (soundIndex) {
        const originalSound = this.editingTarget.getSounds()[soundIndex];
        const clone = Object.assign({}, originalSound);
        clone.id = generateUid();
        return loadSound(
            clone,
            this.runtime,
            this.editingTarget.sprite.soundBank
        ).then(() => {
            const target = this.editingTarget;
            const index = soundIndex + 1;
            target.addSound(clone, index);

            this.runtime.emitTargetSoundsChanged(
                target.originalTargetId, ['add', clone.id, clone]
            );
            this.emitTargetsUpdate();
        });
    }

    /**
     * Rename a costume on the current editing target.
     * @param {int} costumeIndex - the index of the costume to be renamed.
     * @param {string} newName - the desired new name of the costume (will be modified if already in use).
     */
    renameCostume (costumeIndex, newName) {
        this.editingTarget.renameCostume(costumeIndex, newName);
        this.emitTargetsUpdate();
    }

    /**
     * Delete a costume from the current editing target.
     * @param {int} costumeIndex - the index of the costume to be removed.
     * @return {?function} A function to restore the deleted costume, or null,
     * if no costume was deleted.
     */
    deleteCostume (costumeIndex) {
        const deletedCostume = this.editingTarget.deleteCostume(costumeIndex);
        if (deletedCostume) {
            const target = this.editingTarget;
            this.runtime.emitProjectChanged();
            return () => {
                target.addCostume(deletedCostume);
                this.emitTargetsUpdate();
            };
        }
        return null;
    }

    /**
     * Add a sound to the current editing target.
     * @param {!object} soundObject Object representing the sound.
     * @param {string} optTargetId - the id of the target to add to, if not the editing target.
     * @returns {?Promise} - a promise that resolves when the sound has been decoded and added
     */
    addSound (soundObject, optTargetId) {
        const target = optTargetId ?
            this.runtime.getTargetById(optTargetId) :
            this.editingTarget;
        if (target) {
            return loadSound(
                soundObject,
                this.runtime,
                target.sprite.soundBank
            ).then(() => {
                target.addSound(soundObject);
                this.runtime.emitTargetSoundsChanged(target.originalTargetId, ['add', soundObject.id, soundObject]);
                this.emitTargetsUpdate();
            });
        }
        // If the target cannot be found by id, return a rejected promise
        return Promise.reject(new Error(`No target with ID: ${optTargetId}`));
    }

    /**
     * Rename a sound on the current editing target.
     * @param {int} soundIndex - the index of the sound to be renamed.
     * @param {string} newName - the desired new name of the sound (will be modified if already in use).
     */
    renameSound (soundIndex, newName) {
        this.editingTarget.renameSound(soundIndex, newName);
        this.emitTargetsUpdate();
    }

    /**
     * Get a sound buffer from the audio engine.
     * @param {int} soundIndex - the index of the sound to be got.
     * @return {AudioBuffer} the sound's audio buffer.
     */
    getSoundBuffer (soundIndex) {
        const id = this.editingTarget.sprite.sounds[soundIndex].soundId;
        if (id && this.runtime && this.runtime.audioEngine) {
            return this.editingTarget.sprite.soundBank.getSoundPlayer(id)
                .buffer;
        }
        return null;
    }

    /**
     * Sets a configuration property in the Gandi runtime.
     *
     * @param {string} key - The key of the configuration property to set.
     * @param value - The value to set for the configuration property.
     */
    setGandiConfigProperty (key, value) {
        this.runtime.gandi.setConfig(key, value);
    }

    /**
     * Gets a configuration property from the Gandi runtime.
     *
     * @param {string}  key - The key of the configuration property to retrieve.
     * @returns The value of the configuration property.
     */
    getGandiConfigProperty (key) {
        return this.runtime.gandi.getConfig(key);
    }

    getMonitoredKeys () {
        const opcodes = new Set(
            [
                'event_whenkeypressed',
                'sensing_keyoptions',
                'GandiJoystick_whenJoystickMoved',
                'GandiJoystick_getJoystickDistance',
                'GandiJoystick_getJoystickDirection'
            ]
        );
        const keys = new Set();
        const targets = [...this.runtime.targets];
        for (let i = 0; i < targets.length; i++) {
            if (!targets[i].isOriginal) continue;
            const blocks = Object.values(targets[i].blocks._blocks);
            for (let j = 0; j < blocks.length; j++) {
                const block = blocks[j];
                if (opcodes.has(block.opcode)) {
                    const field = block.fields.KEY_OPTION || block.fields.JOYSTICK;
                    keys.add(field.value);
                }
            }
        }
        return [...keys];
    }

    /**
     * Updates global procedure call mutations in the project.
     *
     * @param {string} oldProccode - The old procedure code to be replaced.
     * @param {string} newMutationText - The new mutation text to replace the old mutation.
     * @returns {void}
     */
    updateGlobalProcedureCallMutation (oldProccode, newMutationText) {
        const targets = this.runtime.targets.filter(t => t.isOriginal);
        const newMutation = mutationAdapter(newMutationText);
        targets.forEach(target => {
            if (target !== this.editingTarget) {
                const targetId = target.id;
                const blocksIds = Object.keys(target.blocks._blocks);
                for (let index = 0; index < blocksIds.length; index++) {
                    const block = target.blocks._blocks[blocksIds[index]];
                    // A block may not exist, as there are operations to delete blocks below.
                    if (!block) continue;
                    // Including procedures_call, procedures_call_with_return
                    if (block.opcode.startsWith('procedures_call') && block.mutation.isglobal === 'true' && block.mutation.proccode === oldProccode) {
                        const oldArgIds = JSON.parse(block.mutation.argumentids);
                        block.mutation = newMutation;
                        this.runtime.emitTargetBlocksChanged(targetId, ['update', {[block.id]: {mutation: newMutation}}]);
                        const newArgIds = JSON.parse(block.mutation.argumentids);
                        Object.keys(block.inputs).forEach(key => {
                            if (!newArgIds.includes(key)) {
                                // If it's null, the block in this input moved away.
                                if (block.inputs[key].block !== null) {
                                    target.blocks.deleteBlock(block.inputs[key].block, {source: 'default'});
                                }
                                // Delete obscured shadow blocks.
                                if (block.inputs[key].shadow !== null &&
                                    block.inputs[key].shadow !== block.inputs[key].block) {
                                    target.blocks.deleteBlock(block.inputs[key].shadow, {source: 'default'});
                                }
                                delete block.inputs[key];
                                this.runtime.emitTargetBlocksChanged(targetId, ['deleteInput', {id: block.id, inputName: key}]);
                            }
                        });
                        const newArgTypes = block.mutation.proccode.match(/ %[b|s]/g) || [];
                        newArgIds.forEach((argId, idx) => {
                            // add new input block except boolean
                            if (!oldArgIds.includes(argId) && newArgTypes[idx] !== ' %b') {
                                const textBlockId = generateUid();
                                // Add new input block
                                const shadowBlock = {
                                    id: textBlockId,
                                    opcode: 'text',
                                    inputs: {},
                                    fields: {TEXT: {name: 'TEXT', value: ''}},
                                    next: null,
                                    parent: block.id,
                                    shadow: true,
                                    topLevel: true,
                                    x: 0,
                                    y: 0
                                };
                                target.blocks.createBlock(shadowBlock, 'default');
                                this.runtime.emitTargetBlocksChanged(targetId, ['add', [shadowBlock]]);
                                // Move the shadow block to parent
                                setTimeout(() => {
                                    target.blocks.moveBlock({
                                        id: textBlockId,
                                        oldCoordinate: {x: 0, y: 0},
                                        newParent: block.id,
                                        newInput: argId,
                                        targetId: targetId,
                                        source: 'default'
                                    });
                                }, 0);
                            }
                        });
                    }
                }
            }
        });
    }

    /**
     * Update a sound buffer.
     * @param {int} soundIndex - the index of the sound to be updated.
     * @param {AudioBuffer} newBuffer - new audio buffer for the audio engine.
     * @param {ArrayBuffer} soundEncoding - the new (wav) encoded sound to be stored
     * @param {string} targetId - the id of the target to be updated.
     */
    updateSoundBuffer (soundIndex, newBuffer, soundEncoding, targetId) {
        const target = targetId ? this.runtime.getTargetById(targetId) : this.editingTarget;
        if (!target) {
            throw new Error('No target with the provided id.');
        }
        const sound = target.sprite.sounds[soundIndex];
        if (sound && sound.broken) delete sound.broken;
        const id = sound ? sound.soundId : null;
        if (id && this.runtime && this.runtime.audioEngine) {
            target.sprite.soundBank.getSoundPlayer(id).buffer =
                newBuffer;
        }
        // Update sound in runtime
        if (soundEncoding) {
            // Now that we updated the sound, the format should also be updated
            // so that the sound can eventually be decoded the right way.
            // Sounds that were formerly 'adpcm', but were updated in sound editor
            // will not get decoded by the audio engine correctly unless the format
            // is updated as below.
            sound.format = '';
            const storage = this.runtime.storage;
            sound.asset = storage.createAsset(
                storage.AssetType.Sound,
                storage.DataFormat.WAV,
                soundEncoding,
                null,
                true // generate md5
            );
            sound.assetId = sound.asset.assetId;
            sound.dataFormat = storage.DataFormat.WAV;
            sound.md5 = `${sound.assetId}.${sound.dataFormat}`;
            sound.sampleCount = newBuffer.length;
            sound.rate = newBuffer.sampleRate;
        }
        this.runtime.emitTargetSoundsChanged(target.originalTargetId, ['update', sound.id, sound]);
        // If soundEncoding is null, it's because gui had a problem
        // encoding the updated sound. We don't want to store anything in this
        // case, and gui should have logged an error.

        this.emitTargetsUpdate();
    }

    /**
     * Delete a sound from the current editing target.
     * @param {int} soundIndex - the index of the sound to be removed.
     * @return {?Function} A function to restore the sound that was deleted,
     * or null, if no sound was deleted.
     */
    deleteSound (soundIndex) {
        const target = this.editingTarget;
        const deletedSound = this.editingTarget.deleteSound(soundIndex);
        if (deletedSound) {
            this.runtime.emitTargetSoundsChanged(target.originalTargetId, ['delete', deletedSound.id]);

            this.runtime.emitProjectChanged();
            const restoreFun = () => {
                target.addSound(deletedSound);
                this.runtime.emitTargetSoundsChanged(target.originalTargetId, ['add', deletedSound.id, deletedSound]);
                this.emitTargetsUpdate();
            };
            return restoreFun;
        }
        return null;
    }

    /**
     * Get a string representation of the image from storage.
     * @param {int} costumeIndex - the index of the costume to be got.
     * @return {string} the costume's SVG string if it's SVG,
     *     a dataURI if it's a PNG or JPG, or null if it couldn't be found or decoded.
     */
    getCostume (costumeIndex) {
        const asset = this.editingTarget.getCostumes()[costumeIndex].asset;
        if (!asset || !this.runtime || !this.runtime.storage) return null;
        const format = asset.dataFormat;
        if (format === this.runtime.storage.DataFormat.SVG) {
            return asset.decodeText();
        } else if (
            format === this.runtime.storage.DataFormat.PNG ||
            format === this.runtime.storage.DataFormat.JPG
        ) {
            return asset.encodeDataURI();
        }
        log.error(`Unhandled format: ${asset.dataFormat}`);
        return null;
    }

    updateCostumeById (target, id, newCostume) {
        if (target) {
            loadCostume(
                newCostume.md5,
                newCostume,
                this.runtime,
            ).then(() => {
                const index = target.getCostumeIndexById(id);
                if (index !== -1) {
                    target.sprite.costumes.splice(index, 1, newCostume);
                    if (target.renderer) {
                        target.renderer.updateDrawableSkinId(target.drawableID, newCostume.skinId);
                        target.emitVisualChange();
                        target.runtime.requestTargetsUpdate(target);
                    }
                    this.runtime.emitProjectChanged();
                    this.emitTargetsUpdate();
                }
            });
        }
    }

    updateSoundById (target, id, newSound) {
        if (target) {
            loadSound(
                newSound,
                this.runtime,
                target.sprite.soundBank
            ).then(() => {
                const index = target.getSoundIndexById(id);
                if (index !== -1) {
                    target.sprite.sounds.splice(index, 1, newSound);
                    this.runtime.emitProjectChanged();
                    this.emitTargetsUpdate();
                }
            });
        }
    }

    /**
     * TW: Get the raw binary data to use when exporting a costume to the user's local file system.
     * @param {Costume} costumeObject scratch-vm costume object
     * @returns {Uint8Array}
     */
    getExportedCostume (costumeObject) {
        return exportCostume(costumeObject);
    }

    /**
     * TW: Get a base64 string to use when exporting a costume to the user's local file system.
     * @param {Costume} costumeObject scratch-vm costume object
     * @returns {string} base64 string. Not a data: URI.
     */
    getExportedCostumeBase64 (costumeObject) {
        const binaryData = this.getExportedCostume(costumeObject);
        return Base64Util.uint8ArrayToBase64(binaryData);
    }

    /**
     * Update a costume with the given bitmap
     * @param {!int} costumeIndex - the index of the costume to be updated.
     * @param {!ImageData} bitmap - new bitmap for the renderer.
     * @param {!number} rotationCenterX x of point about which the costume rotates, relative to its upper left corner
     * @param {!number} rotationCenterY y of point about which the costume rotates, relative to its upper left corner
     * @param {!number} bitmapResolution 1 for bitmaps that have 1 pixel per unit of stage,
     *     2 for double-resolution bitmaps
     * @param {string} targetId ID of a target.
     */
    updateBitmap (costumeIndex, bitmap, rotationCenterX, rotationCenterY, bitmapResolution, targetId) {
        return this._updateBitmap(
            this.editingTarget.getCostumes()[costumeIndex],
            bitmap,
            rotationCenterX,
            rotationCenterY,
            bitmapResolution,
            targetId
        );
    }

    _updateBitmap (costume, bitmap, rotationCenterX, rotationCenterY, bitmapResolution, targetId) {
        if (!(costume && this.runtime && this.runtime.renderer)) return;
        const target = targetId ? this.runtime.getTargetById(targetId) : this.editingTarget;
        if (costume && costume.broken) delete costume.broken;

        costume.rotationCenterX = rotationCenterX;
        costume.rotationCenterY = rotationCenterY;

        // If the bitmap originally had a zero width or height, use that value
        const bitmapWidth = bitmap.sourceWidth === 0 ? 0 : bitmap.width;
        const bitmapHeight = bitmap.sourceHeight === 0 ? 0 : bitmap.height;
        // @todo: updateBitmapSkin does not take ImageData
        const canvas = document.createElement('canvas');
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
        const context = canvas.getContext('2d');
        context.putImageData(bitmap, 0, 0);

        // Divide by resolution because the renderer's definition of the rotation center
        // is the rotation center divided by the bitmap resolution
        this.runtime.renderer.updateBitmapSkin(
            costume.skinId,
            canvas,
            bitmapResolution,
            [
                rotationCenterX / bitmapResolution,
                rotationCenterY / bitmapResolution
            ]
        );

        // @todo there should be a better way to get from ImageData to a decodable storage format
        canvas.toBlob(blob => {
            const reader = new FileReader();
            reader.addEventListener('loadend', () => {
                const storage = this.runtime.storage;
                costume.dataFormat = storage.DataFormat.PNG;
                costume.bitmapResolution = bitmapResolution;
                costume.size = [bitmapWidth, bitmapHeight];
                costume.asset = storage.createAsset(
                    storage.AssetType.ImageBitmap,
                    costume.dataFormat,
                    Buffer.from(reader.result),
                    null, // id
                    true // generate md5
                );
                costume.assetId = costume.asset.assetId;
                costume.md5 = `${costume.assetId}.${costume.dataFormat}`;
                this.runtime.emitTargetCostumeChanged(target.originalTargetId,
                    ['update', costume.id, {
                        assetId: costume.assetId,
                        bitmapResolution: costume.bitmapResolution,
                        dataFormat: costume.dataFormat,
                        md5ext: costume.md5,
                        name: costume.name,
                        rotationCenterX: costume.rotationCenterX,
                        rotationCenterY: costume.rotationCenterY
                    }]);
                this.emitTargetsUpdate();
            });
            // Bitmaps with a zero width or height return null for their blob
            if (blob) {
                reader.readAsArrayBuffer(blob);
            }
        });
    }

    /**
     * Update a costume with the given SVG
     * @param {int} costumeIndex - the index of the costume to be updated.
     * @param {string} svg - new SVG for the renderer.
     * @param {number} rotationCenterX x of point about which the costume rotates, relative to its upper left corner
     * @param {number} rotationCenterY y of point about which the costume rotates, relative to its upper left corner
     * @param {string} targetId ID of a target.
     */
    updateSvg (costumeIndex, svg, rotationCenterX, rotationCenterY, targetId) {
        return this._updateSvg(
            this.editingTarget.getCostumes()[costumeIndex],
            svg,
            rotationCenterX,
            rotationCenterY,
            targetId
        );
    }

    _updateSvg (costume, svg, rotationCenterX, rotationCenterY, targetId) {
        const target = targetId ? this.runtime.getTargetById(targetId) : this.editingTarget;
        if (costume && costume.broken) delete costume.broken;
        if (costume && this.runtime && this.runtime.renderer) {
            costume.rotationCenterX = rotationCenterX;
            costume.rotationCenterY = rotationCenterY;
            this.runtime.renderer.updateSVGSkin(costume.skinId, svg, [
                rotationCenterX,
                rotationCenterY
            ]);
            costume.size = this.runtime.renderer.getSkinSize(costume.skinId);
        }
        const storage = this.runtime.storage;
        // If we're in here, we've edited an svg in the vector editor,
        // so the dataFormat should be 'svg'
        costume.dataFormat = storage.DataFormat.SVG;
        costume.bitmapResolution = 1;
        costume.asset = storage.createAsset(
            storage.AssetType.ImageVector,
            costume.dataFormat,
            new _TextEncoder().encode(svg),
            null,
            true // generate md5
        );
        costume.assetId = costume.asset.assetId;
        costume.md5 = `${costume.assetId}.${costume.dataFormat}`;
        const {assetId, bitmapResolution, dataFormat, md5, name, id} = costume;
        this.runtime.emitTargetCostumeChanged(target.originalTargetId, ['update', id, {
            assetId,
            bitmapResolution,
            dataFormat,
            md5ext: md5,
            name,
            rotationCenterX,
            rotationCenterY
        }]);
        this.emitTargetsUpdate();
    }

    /**
     * Update a Gandi asset with the value
     * @param {string} assetMd5 - the md5 of the asset to be updated.
     * @param {string} newValue - new Value for the asset.
     */
    updateGandiAssetData (fileName, newValue) {
        const file = this.getGandiAssetFile(fileName);
        if (!file) {
            throw new Error(`Could not find asset with file name ${fileName}`);
        }
        file.asset.encodeTextData(newValue, file.dataFormat, true);
        file.assetId = file.asset.assetId;
        file.md5 = `${file.asset.assetId}.${file.asset.dataFormat}`;
        this.emitGandiAssetsUpdate({type: 'update', data: file});
    }

    updateGandiAssetFromRemote (id, newAsset) {
        const file = {
            asset: null,
            id,
            assetId: newAsset.assetId,
            name: newAsset.name,
            md5: newAsset.md5ext,
            dataFormat: newAsset.dataFormat
        };
        loadGandiAsset(newAsset.md5ext, file, this.runtime).then(gandiAssetObj => {
            if (id && this.runtime.gandi.assets.length > 0) {
                this.runtime.gandi.assets.forEach((asset, index) => {
                    if (asset.id === gandiAssetObj.id) {
                        this.runtime.gandi.assets[index] = gandiAssetObj;
                    }
                });
                this.runtime.emitGandiAssetsUpdateFromServer({type: 'update', data: gandiAssetObj});
            }
        });
    }

    addGandiAssetFromRemote (id, newAsset) {
        const file = {
            asset: null,
            id,
            assetId: newAsset.assetId,
            name: newAsset.name,
            md5: newAsset.md5ext,
            dataFormat: newAsset.dataFormat
        };
        loadGandiAsset(newAsset.md5ext, file, this.runtime).then(gandiAssetObj => {
            this.runtime.gandi.assets.push(gandiAssetObj);
            this.runtime.emitGandiAssetsUpdateFromServer({type: 'add', data: gandiAssetObj});
        });
    }

    deleteGandiAssetFromRemote (id) {
        if (id && this.runtime.gandi.assets.length > 0) {
            const index = this.runtime.gandi.assets.findIndex(asset => asset.id === id);
            if (index > -1) {
                const deleted = this.runtime.gandi.assets.splice(index, 1);
                if (deleted.length > 0) {
                    this.runtime.emitGandiAssetsUpdateFromServer({type: 'delete', data: deleted[0]});
                }
            } else {
                log.warn(`deleteGandiAssetFromRemote: id:${id} not found`);
            }
        } else {
            log.warn(`deleteGandiAssetFromRemote: id:${id} or no assets`);
        }
    }

    /**
     * rename a Gandi asset
     * @param {string} id - The id of the asset to rename.
     * @param {string} newName - new name for the asset.
     */
    renameGandiAssetById (id, newName) {
        const file = this.getGandiAssetById(id);
        const newFileFullName = `${newName}.${file.dataFormat}`;
        if (this.getGandiAssetFile(newFileFullName)) {
            throw new Error(`Asset with name ${newFileFullName} already exists`);
        }
        file.name = newName;
        const storage = this.runtime.storage;
        if (file.asset && file.asset.dataFormat === storage.DataFormat.JAVASCRIPT) {
            // file name 'extension.js' is a reserved name means assetType is Extension
            file.asset.assetType = file.name.toLowerCase() === storage.AssetType.Extension.name.toLowerCase() ? storage.AssetType.Extension : storage.AssetType.JavaScript;
        }
        this.emitGandiAssetsUpdate({type: 'update', data: file});
        return file;
    }

    /**
     * Delete a sprite and all its clones.
     * @param {string} fileName name of a asset.
     */
    deleteGandiAsset (fileName) {
        const file = this.getGandiAssetFile(fileName);
        if (!file) {
            throw new Error(`Could not find asset with file name ${fileName}`);
        }
        const index = this.runtime.gandi.assets.indexOf(file);
        this.runtime.gandi.assets.splice(index, 1);
        this.emitGandiAssetsUpdate({type: 'delete', data: file});
    }

    /**
     * Delete a file from the Gandi assets.
     * @param {string} id The id of the asset to delete.
     */
    deleteGandiAssetById (id) {
        const {file, index} = this.getGandiAssetIndexAndFileById(id);
        if (index === -1) {
            throw new Error(`Could not find asset with file name ${file.name}.${file.dataFormat}`);
        }
        this.runtime.gandi.assets.splice(index, 1);
        this.emitGandiAssetsUpdate({type: 'delete', data: file});
    }

    /**
     * Add a backdrop to the stage.
     * @param {string} md5ext - the MD5 and extension of the backdrop to be loaded.
     * @param {!object} backdropObject Object representing the backdrop.
     * @property {int} skinId - the ID of the backdrop's render skin, once installed.
     * @property {number} rotationCenterX - the X component of the backdrop's origin.
     * @property {number} rotationCenterY - the Y component of the backdrop's origin.
     * @property {number} [bitmapResolution] - the resolution scale for a bitmap backdrop.
     * @returns {?Promise} - a promise that resolves when the backdrop has been added
     */
    addBackdrop (md5ext, backdropObject) {
        return loadCostume(md5ext, backdropObject, this.runtime).then(() => {
            const stage = this.runtime.getTargetForStage();
            stage.addCostume(backdropObject);
            stage.setCostume(stage.getCostumes().length - 1);
            this.runtime.emitProjectChanged();
        });
    }

    /**
     * Rename a sprite.
     * @param {string} targetId ID of a target whose sprite to rename.
     * @param {string} newName New name of the sprite.
     * @param {boolean} [sendNameChangedEvent = true] whether to send an event when the sprite name changes.
     */
    renameSprite (targetId, newName, sendNameChangedEvent = true) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            if (!target.isSprite()) {
                throw new Error('Cannot rename non-sprite targets.');
            }
            const sprite = target.sprite;
            if (!sprite) {
                throw new Error('No sprite associated with this target.');
            }
            if (newName && RESERVED_NAMES.indexOf(newName) === -1) {
                const names = this.runtime.targets
                    .filter(
                        runtimeTarget =>
                            runtimeTarget.isSprite() &&
                            runtimeTarget.id !== target.id
                    )
                    .map(runtimeTarget => runtimeTarget.sprite.name);
                const oldName = sprite.name;
                const newUnusedName = StringUtil.unusedName(newName, names);
                sprite.name = newUnusedName;
                if (oldName === newUnusedName || newUnusedName.startsWith('#modules/')) {
                    return;
                }
                const allTargets = this.runtime.targets;
                for (let i = 0; i < allTargets.length; i++) {
                    const currTarget = allTargets[i];
                    currTarget.blocks.updateAssetName(
                        oldName,
                        newName,
                        'sprite',
                        currTarget.originalTargetId
                    );
                }
                if (newUnusedName !== oldName) {
                    if (sendNameChangedEvent) {
                        this.runtime.emitTargetSimplePropertyChanged([[targetId, {name: newUnusedName}]]);
                    }
                    this.emitTargetsUpdate();
                }
            }
        } else {
            throw new Error('No target with the provided id.');
        }
    }

    /**
     * Delete a sprite and all its clones.
     * @param {string} targetId ID of a target whose sprite to delete.
     * @param {boolean} isRemoteOperation Whether this is a remote operation.
     * @return {Function} Returns a function to restore the sprite that was deleted
     */
    deleteSprite (targetId, isRemoteOperation) {
        const target = this.runtime.getTargetById(targetId);

        if (target) {
            const targetIndexBeforeDelete = this.runtime.targets
                .map(t => t.id)
                .indexOf(target.id);
            if (!target.isSprite()) {
                throw new Error('Cannot delete non-sprite targets.');
            }
            const sprite = target.sprite;
            if (!sprite) {
                throw new Error('No sprite associated with this target.');
            }
            const spritePromise = this.exportSprite(targetId, 'uint8array');
            const restoreSprite = () =>
                spritePromise.then(spriteBuffer =>
                    this.addSprite(spriteBuffer)
                );
            // Remove monitors from the runtime state and remove the
            // target-specific monitored blocks (e.g. local variables)
            target.deleteMonitors();
            const spriteClones = [...sprite.clones];
            for (let i = 0; i < spriteClones.length; i++) {
                const clone = spriteClones[i];
                this.runtime.stopForTarget(spriteClones[i]);
                this.runtime.disposeTarget(spriteClones[i]);
                // Ensure editing target is switched if we are deleting it.
                if (clone === this.editingTarget) {
                    const nextTargetIndex = Math.min(
                        this.runtime.targets.length - 1,
                        targetIndexBeforeDelete
                    );
                    if (this.runtime.targets.length > 0) {
                        this.setEditingTarget(
                            this.runtime.targets[nextTargetIndex].id
                        );
                    } else {
                        this.editingTarget = null;
                    }
                }
            }
            if (!isRemoteOperation) {
                this.emit('DELETE_SPRITE', targetId, target.sprite.name);
            }
            // Sprite object should be deleted by GC.
            this.emitTargetsUpdate();
            return restoreSprite;
        }

        throw new Error('No target with the provided id.');
    }

    /**
     * Duplicate a sprite.
     * @param {string} targetId ID of a target whose sprite to duplicate.
     * @returns {Promise} Promise that resolves when duplicated target has
     *     been added to the runtime.
     */
    duplicateSprite (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (!target) {
            throw new Error('No target with the provided id.');
        } else if (!target.isSprite()) {
            throw new Error('Cannot duplicate non-sprite targets.');
        } else if (!target.sprite) {
            throw new Error('No sprite associated with this target.');
        }
        return target.duplicate().then(newTarget => {
            this.runtime.addTarget(newTarget);
            this.emit('ADD_SPRITE', newTarget.id);
            newTarget.goBehindOther(target);
            this.setEditingTarget(newTarget.id);
        });
    }

    /**
     * Set the audio engine for the VM/runtime
     * @param {!AudioEngine} audioEngine The audio engine to attach
     */
    attachAudioEngine (audioEngine) {
        this.runtime.attachAudioEngine(audioEngine);
    }

    /**
     * Set the renderer for the VM/runtime
     * @param {!RenderWebGL} renderer The renderer to attach
     */
    attachRenderer (renderer) {
        this.runtime.attachRenderer(renderer);
    }

    /**
     * @returns {RenderWebGL} The renderer attached to the vm
     */
    get renderer () {
        return this.runtime && this.runtime.renderer;
    }

    // @deprecated
    attachV2SVGAdapter () { }

    /**
     * Set the bitmap adapter for the VM/runtime, which converts scratch 2
     * bitmaps to scratch 3 bitmaps. (Scratch 3 bitmaps are all bitmap resolution 2)
     * @param {!function} bitmapAdapter The adapter to attach
     */
    attachV2BitmapAdapter (bitmapAdapter) {
        this.runtime.attachV2BitmapAdapter(bitmapAdapter);
    }

    /**
     * Set the storage module for the VM/runtime
     * @param {!ScratchStorage} storage The storage module to attach
     */
    attachStorage (storage) {
        this.runtime.attachStorage(storage);
    }

    /**
     * set the current locale and builtin messages for the VM
     * @param {!string} locale       current locale
     * @param {!object} messages     builtin messages map for current locale
     * @returns {Promise} Promise that resolves when all the blocks have been
     *     updated for a new locale (or empty if locale hasn't changed.)
     */
    setLocale (locale, messages) {
        // The locale of formatMessage defaults to 'en'. If the locale of the GUI is also 'en', the translations will always be an empty object.
        // Therefore, it should be changed to compare using messages instead.
        if (locale !== formatMessage.setup().locale || messages !== formatMessage.setup().translations[locale]) {
            formatMessage.setup({
                locale: locale,
                translations: {[locale]: messages}
            });
        }
        this.emit('LOCALE_CHANGED', locale);
        return this.extensionManager.refreshBlocks();
    }

    /**
     * get the current locale for the VM
     * @returns {string} the current locale in the VM
     */
    getLocale () {
        return formatMessage.setup().locale;
    }

    /**
     * Handle a Blockly event for the current editing target.
     * @param {!Blockly.Event} e Any Blockly event.
     */
    frameListener (e) {
        if (this.editingTarget && typeof e === 'object' && e.type.startsWith('frame_')) {
            this.editingTarget.frames.blocklyListen(e);
        }
    }

    /**
     * Handle a Blockly event for the current editing target.
     * @param {!Blockly.Event} e Any Blockly event.
     */
    blockListener (e) {
        if (this.editingTarget) {
            this.editingTarget.blocks.blocklyListen(e, 'default');
        }
    }

    /**
     * Handle a Blockly event for the flyout.
     * @param {!Blockly.Event} e Any Blockly event.
     */
    flyoutBlockListener (e) {
        this.runtime.flyoutBlocks.blocklyListen(e, 'flyout');
    }

    /**
     * Handle a Blockly event for the flyout to be passed to the monitor container.
     * @param {!Blockly.Event} e Any Blockly event.
     */
    monitorBlockListener (e) {
        // Filter events by type, since monitor blocks only need to listen to these events.
        // Monitor blocks shouldn't be destroyed when flyout blocks are deleted.
        if (['create', 'change'].indexOf(e.type) !== -1) {
            this.runtime.monitorBlocks.blocklyListen(e, 'monitor');
        }
    }

    /**
     * Handle a Blockly event for the variable map.
     * @param {!Blockly.Event} e Any Blockly event.
     */
    variableListener (e) {
        // Filter events by type, since blocks only needs to listen to these
        // var events.
        if (['var_create', 'var_rename', 'var_delete'].indexOf(e.type) !== -1) {
            this.runtime.getTargetForStage().blocks.blocklyListen(e, 'variable');
        }
    }

    /**
     * Delete all of the flyout blocks.
     */
    clearFlyoutBlocks () {
        this.runtime.flyoutBlocks.deleteAllBlocks();
    }

    /**
     * Set an editing target. An editor UI can use this function to switch
     * between editing different targets, sprites, etc.
     * After switching the editing target, the VM may emit updates
     * to the list of targets and any attached workspace blocks
     * (see `emitTargetsUpdate` and `emitWorkspaceUpdate`).
     * @param {string} targetId Id of target to set as editing.
     */
    setEditingTarget (targetId) {
        // Has the target id changed? If not, exit.
        if (this.editingTarget && targetId === this.editingTarget.id) {
            return;
        }
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            this.editingTarget = target;
            // Emit appropriate UI updates.
            this.emitTargetsUpdate(false /* Don't emit project change */);
            this.emitWorkspaceUpdate();
            this.runtime.setEditingTarget(target);
        }
    }

    /**
     * @param {Block[]} blockObjects
     * @returns {object}
     */
    exportStandaloneBlocks (blockObjects) {
        const sb3 = require('./serialization/sb3');
        const serialized = sb3.serializeStandaloneBlocks(blockObjects, this.runtime);
        return serialized;
    }

    /**
     * Called when blocks are dragged from one sprite to another. Adds the blocks to the
     * workspace of the given target.
     * @param {!Array<object>} blocks Blocks to add.
     * @param {!string} targetId Id of target to add blocks to.
     * @param {?string} optFromTargetId Optional target id indicating that blocks are being
     * shared from that target. This is needed for resolving any potential variable conflicts.
     * @return {!Promise} Promise that resolves when the extensions and blocks have been added.
     */
    shareBlocksToTarget (blocks, targetId, optFromTargetId) {
        const sb3 = require('./serialization/sb3');
        // TODO: support any remote extensions in block
        const {blocks: copiedBlocks, extensionURLs} = sb3.deserializeStandaloneBlocks(blocks);
        const blockIdOldToNewMap = newBlockIds(copiedBlocks);
        const target = this.runtime.getTargetById(targetId);

        if (optFromTargetId) {
            // If the blocks are being shared from another target,
            // resolve any possible variable conflicts that may arise.
            const fromTarget = this.runtime.getTargetById(optFromTargetId);
            fromTarget.resolveVariableSharingConflictsWithTarget(
                copiedBlocks,
                target
            );
        } else {
            // From use bag or asset store
            target.resolveVariableSharingConflicts(copiedBlocks);
        }

        // Create a unique set of extensionIds that are not yet loaded
        const extensionIDs = new Set(
            copiedBlocks
                .map(b => sb3.getExtensionIdForOpcode(b.opcode))
                .filter(id => !!id) // Remove ids that do not exist
                .filter(id => !this.extensionManager.isExtensionLoaded(id)) // and remove loaded extensions
        );

        // Create an array promises for extensions to load
        const extensionPromises = Array.from(extensionIDs, id =>
            // Only support builtin extension for now, so not using extensionURLs to load
            this.extensionManager.loadExtensionURL(id)
        );

        return Promise.all(extensionPromises).then(() => {
            copiedBlocks.forEach(block => {
                target.blocks.createBlock(block, 'default');
            });
            if (copiedBlocks.length) {
                this.runtime.emitTargetBlocksChanged(targetId, ['add', copiedBlocks]);
            }
            target.blocks.updateTargetSpecificBlocks(target.isStage);
            return blockIdOldToNewMap;
        });
    }

    /**
     * Called when frame are dragged from one sprite to another. Adds the frame to the
     * workspace of the given target.
     * @param {!Array<object>} frame Frame to add.
     * @param {!string} targetId Id of target to add frame to.
     * @param {?string} optFromTargetId Optional target id indicating that frame are being
     * shared from that target. This is needed for resolving any potential variable conflicts.
     * @return {!Promise} Promise that resolves when the extensions and frame have been added.
     */
    async shareFrameToTarget (frame, targetId, optFromTargetId) {
        const clone = JSON.parse(JSON.stringify(frame));
        const blocks = clone.blockElements;
        clone.id = generateUid();
        const target = this.runtime.getTargetById(targetId);
        if (Object.keys(blocks).length > 0) {
            const blockIdOldToNewMap = await this.shareBlocksToTarget(Object.values(blocks), targetId, optFromTargetId);
            clone.blocks = clone.blocks.map(blockId => blockIdOldToNewMap[blockId]);
        }
        target.createFrame(clone);
        this.runtime.emitTargetFramesChanged(targetId, ['add', clone.id, clone]);
        target.blocks.updateTargetSpecificBlocks(target.isStage);
    }

    /**
     * Called when costumes are dragged from editing target to another target.
     * Sets the newly added costume as the current costume.
     * @param {!number} costumeIndex Index of the costume of the editing target to share.
     * @param {!string} targetId Id of target to add the costume.
     * @return {Promise} Promise that resolves when the new costume has been loaded.
     */
    shareCostumeToTarget (costumeIndex, targetId) {
        const originalCostume = this.editingTarget.getCostumes()[costumeIndex];
        const clone = Object.assign({}, originalCostume);
        clone.id = generateUid();
        const md5ext = `${clone.assetId}.${clone.dataFormat}`;
        return loadCostume(md5ext, clone, this.runtime).then(() => {
            const target = this.runtime.getTargetById(targetId);
            if (target) {
                target.addCostume(clone);
                target.setCostume(target.getCostumes().length - 1);
            }
        });
    }

    /**
     * Called when sounds are dragged from editing target to another target.
     * @param {!number} soundIndex Index of the sound of the editing target to share.
     * @param {!string} targetId Id of target to add the sound.
     * @return {Promise} Promise that resolves when the new sound has been loaded.
     */
    shareSoundToTarget (soundIndex, targetId) {
        const originalSound = this.editingTarget.getSounds()[soundIndex];
        const clone = Object.assign({}, originalSound);
        clone.id = generateUid();
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            return loadSound(clone, this.runtime, target.sprite.soundBank).then(
                () => {
                    if (this.runtime.getTargetById(targetId)) {
                        target.addSound(clone);
                        this.runtime.emitTargetSoundsChanged(target.originalTargetId,
                            ['add', clone.id, clone]
                        );
                        this.emitTargetsUpdate();
                    }
                }
            );
        }
    }

    /**
     * Repopulate the workspace with the blocks of the current editingTarget. This
     * allows us to get around bugs like gui#413.
     */
    refreshWorkspace () {
        if (this.editingTarget) {
            this.emitWorkspaceUpdate();
            this.runtime.setEditingTarget(this.editingTarget);
            this.emitTargetsUpdate(false /* Don't emit project change */);
        }
    }

    /**
     * Emit metadata about available targets.
     * An editor UI could use this to display a list of targets and show
     * the currently editing one.
     * @param {boolean} triggerProjectChange If true, also emit a project changed event.
     * Disabled selectively by updates that don't affect project serialization.
     * Defaults to true.
     */
    emitTargetsUpdate (triggerProjectChange = true, updatedTargets) {
        if (typeof triggerProjectChange === 'undefined') {
            triggerProjectChange = true;
        }
        let lazyTargetList;
        const getTargetListLazily = () => {
            if (!lazyTargetList) {
                lazyTargetList = this.runtime.targets
                    .filter(
                        // Don't report clones.
                        target => !Object.prototype.hasOwnProperty.call(target, 'isOriginal') || target.isOriginal
                    ).map(
                        target => target.toJSON()
                    );
            }
            return lazyTargetList;
        };
        this.emit('targetsUpdate', {
            // [[target id, human readable target name], ...].
            get targetList () {
                return getTargetListLazily();
            },
            // Currently editing target id.
            editingTarget: this.editingTarget ? this.editingTarget.id : null,
            updatedTargets
        });
        if (triggerProjectChange) {
            this.runtime.emitProjectChanged();
        }
    }

    /**
     * Emit an Blockly/scratch-blocks compatible XML representation
     * of the current editing target's blocks.
     */
    emitWorkspaceUpdate () {
        // Create a list of broadcast message Ids according to the stage variables
        const stageVariables = this.runtime.getTargetForStage().variables;
        let messageIds = [];
        for (const varId in stageVariables) {
            if (
                stageVariables[varId].type === Variable.BROADCAST_MESSAGE_TYPE
            ) {
                messageIds.push(varId);
            }
        }
        // Go through all blocks on all targets, removing referenced
        // broadcast ids from the list.
        for (let i = 0; i < this.runtime.targets.length; i++) {
            const currTarget = this.runtime.targets[i];
            const currBlocks = currTarget.blocks._blocks;
            for (const blockId in currBlocks) {
                if (currBlocks[blockId].fields.BROADCAST_OPTION) {
                    const id = currBlocks[blockId].fields.BROADCAST_OPTION.id;
                    const index = messageIds.indexOf(id);
                    if (index !== -1) {
                        messageIds = messageIds
                            .slice(0, index)
                            .concat(messageIds.slice(index + 1));
                    }
                }
            }
        }
        // Anything left in messageIds is not referenced by a block, so delete it.
        for (let i = 0; i < messageIds.length; i++) {
            const id = messageIds[i];
            delete this.runtime.getTargetForStage().variables[id];
        }
        const globalVarMap = Object.assign(
            {},
            this.runtime.getTargetForStage().variables
        );
        const localVarMap = this.editingTarget.isStage ?
            Object.create(null) :
            Object.assign({}, this.editingTarget.variables);

        const globalVariables = Object.keys(globalVarMap).map(
            k => globalVarMap[k]
        );
        const localVariables = Object.keys(localVarMap).map(
            k => localVarMap[k]
        );
        const frames = Object.values(this.editingTarget.frames._frames);

        const workspaceComments = Object.keys(this.editingTarget.comments)
            .map(k => this.editingTarget.comments[k])
            .filter(c => c.blockId === null);

        const xmlString = `<xml xmlns="http://www.w3.org/1999/xhtml">
                            <variables>
                                ${globalVariables.map(v => v.toXML()).join()}
                                ${localVariables.map(v => v.toXML(true)).join()}
                            </variables>

                            <procedures>
                                ${this.getWorkspaceGlobalProcedures().join()}
                            </procedures>
                            ${workspaceComments.map(c => c.toXML()).join()}
                            ${this.editingTarget.blocks.toXML(this.editingTarget.comments)}
                            <custom-frameset>
                                ${frames.map(i => this.editingTarget.frames.frameToXML(i)).join()}
                            </custom-frameset>
                        </xml>`;

        this.emit('workspaceUpdate', {xml: xmlString});
    }

    /**
     * Emit metadata about Gandi assets file.
     * An editor UI could use this to display a list of files and show
     * the currently editing one.
     * @param {{data:object, type: 'add'|'update'|'delete', isFromRemote:bool}} action If true, also emit a project changed event.
     * Defaults to true.
     */
    emitGandiAssetsUpdate ({data, type}) {
        this.runtime.emitGandiAssetsUpdate({data, type});
        this.runtime.emitProjectChanged();
    }

    /**
     * Get a target id for a drawable id. Useful for interacting with the renderer
     * @param {number} drawableId The drawable id to request the target id for
     * @returns {?string} The target id, if found. Will also be null if the target found is the stage.
     */
    getTargetIdForDrawableId (drawableId) {
        const target = this.runtime.getTargetByDrawableId(drawableId);
        if (target &&
            Object.prototype.hasOwnProperty.call(target, 'id') &&
            Object.prototype.hasOwnProperty.call(target, 'isStage') &&
            !target.isStage) {
            return target.id;
        }
        return null;
    }

    /**
     * CCW: Get all global procedures and pass to target
     * @returns {Array} Array of XML strings
     */
    getWorkspaceGlobalProcedures () {
        let globalProcedures = [];
        for (let i = 0; i < this.runtime.targets.length; i++) {
            const target = this.runtime.targets[i];
            if (target === this.editingTarget) {
                // skip self avoid duplicate procedure
                continue;
            }
            globalProcedures = globalProcedures.concat(target.blocks.getGlobalProceduresXML());
        }
        return globalProcedures;
    }

    /**
     * Reorder target by index. Return whether a change was made.
     * @param {!string} targetIndex Index of the target.
     * @param {!number} newIndex index that the target should be moved to.
     * @param {!boolean} isRemoteOperation - set to true if this is a remote operation
     * @returns {boolean} Whether a target was reordered.
     */
    reorderTarget (targetIndex, newIndex, isRemoteOperation) {
        const targets = [...this.runtime.targets];
        const originalTargets = targets.filter(t => t.isOriginal);
        const processedData = MathUtil.moveArrayElement(originalTargets, targetIndex, newIndex);
        if (processedData.array === originalTargets) return false;

        const target = originalTargets[processedData.fromIndex];
        const newIndexTarget = originalTargets[processedData.toIndex];
        const fromIndex = targets.findIndex(t => t.id === target.id);
        const toIndex = targets.findIndex(t => t.id === newIndexTarget.id);
        this.runtime.targets = MathUtil.moveArrayElement(targets, fromIndex, toIndex).array;

        if (!isRemoteOperation) {
            this.runtime.emitTargetsIndexChanged([{id: target.id, currentIndex: processedData.toIndex}]);
        }
        this.emitTargetsUpdate();
        return true;
    }

    /**
     * Reorder the costumes of a target if it exists. Return whether it succeeded.
     * @param {!string} targetId ID of the target which owns the costumes.
     * @param {!number} costumeIndex index of the costume to move.
     * @param {!number} newIndex index that the costume should be moved to.
     * @returns {boolean} Whether a costume was reordered.
     */
    reorderCostume (targetId, costumeIndex, newIndex) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            const reorderSuccessful = target.reorderCostume(
                costumeIndex,
                newIndex
            );
            if (reorderSuccessful) {
                this.runtime.emitProjectChanged();
            }
            return reorderSuccessful;
        }
        return false;
    }

    /**
     * Reorder the sounds of a target if it exists. Return whether it occured.
     * @param {!string} targetId ID of the target which owns the sounds.
     * @param {!number} soundIndex index of the sound to move.
     * @param {!number} newIndex index that the sound should be moved to.
     * @returns {boolean} Whether a sound was reordered.
     */
    reorderSound (targetId, soundIndex, newIndex) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            const reorderSuccessful = target.reorderSound(soundIndex, newIndex);
            if (reorderSuccessful) {
                this.runtime.emitProjectChanged();
            }
            return reorderSuccessful;
        }
        return false;
    }

    /**
     * Put a target into a "drag" state, during which its X/Y positions will be unaffected
     * by blocks.
     * @param {string} targetId The id for the target to put into a drag state
     */
    startDrag (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            this._dragTarget = target;
            target.startDrag();
        }
    }

    /**
     * Remove a target from a drag state, so blocks may begin affecting X/Y position again
     * @param {string} targetId The id for the target to remove from the drag state
     */
    stopDrag (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            this._dragTarget = null;
            target.stopDrag();
            this.setEditingTarget(
                target.sprite && target.sprite.clones[0] ?
                    target.sprite.clones[0].id :
                    target.id
            );
        }
    }

    /**
     * Post/edit sprite info for the current editing target or the drag target.
     * @param {object} data An object with sprite info data to set.
     * @param {?string} targetId The id for the target to set info.
     */
    postSpriteInfo (data, targetId) {
        const target = targetId ? this.runtime.getTargetById(targetId) : this.editingTarget;

        if (this._dragTarget) {
            this._dragTarget.postSpriteInfo(data);
        } else {
            target.postSpriteInfo(data);
        }
        // Post sprite info means the gui has changed something about a sprite,
        // either through the sprite info pane fields (e.g. direction, size) or
        // through dragging a sprite on the stage
        // Emit a project changed event.
        this.runtime.emitProjectChanged();
    }

    /**
     * Set a target's variable's value. Return whether it succeeded.
     * @param {!string} targetId ID of the target which owns the variable.
     * @param {!string} variableId ID of the variable to set.
     * @param {!*} value The new value of that variable.
     * @returns {boolean} whether the target and variable were found and updated.
     */
    setVariableValue (targetId, variableId, value) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            const variable = target.lookupVariableById(variableId);
            if (variable) {
                variable.value = value;

                if (variable.isCloud) {
                    this.runtime.ioDevices.cloud.requestUpdateVariable(
                        variable.name,
                        variable.value
                    );
                }

                return true;
            }
        }
        return false;
    }

    /**
     * Get a target's variable's value. Return null if the target or variable does not exist.
     * @param {!string} targetId ID of the target which owns the variable.
     * @param {!string} variableId ID of the variable to set.
     * @returns {?*} The value of the variable, or null if it could not be looked up.
     */
    getVariableValue (targetId, variableId) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            const variable = target.lookupVariableById(variableId);
            if (variable) {
                return variable.value;
            }
        }
        return null;
    }

    /**
     * Allow VM consumer to configure the ScratchLink socket creator.
     * @param {Function} factory The custom ScratchLink socket factory.
     */
    configureScratchLinkSocketFactory (factory) {
        this.runtime.configureScratchLinkSocketFactory(factory);
    }

    /**
     * Adapts a given XML element for blocks or frames.
     *
     * @param {Element} xml - The XML element to be adapted.
     * @returns {Array.<object> | null} A list of block or frame from the adapted XML.
     */
    xmlAdapter (xml) {
        if (!xml || !(xml instanceof Element)) {
            log.error('A valid XML DOM element must be provided.');
            return null;
        }
        return adapter({xml});
    }
}

module.exports = VirtualMachine;
