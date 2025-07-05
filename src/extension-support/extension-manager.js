const dispatch = require('../dispatch/central-dispatch');
const log = require('../util/log');
const maybeFormatMessage = require('../util/maybe-format-message');
const formatMessage = require('format-message');
const BlockType = require('./block-type');
const {setupScratchAPI, clearScratchAPI, createdScriptLoader} = require('./extension-load-helper');
const SecurityManager = require('./tw-security-manager');

// These extensions are currently built into the VM repository but should not be loaded at startup.
// TODO: move these out into a separate repository?
// TODO: change extension spec so that library info, including extension ID, can be collected through static methods

const defaultBuiltinExtensions = {
    // This is an example that isn't loaded with the other core blocks,
    // but serves as a reference for loading core blocks as extensions.
    coreExample: () => require('../blocks/scratch3_core_example'),
    // These are the non-core built-in extensions.
    pen: () => require('../extensions/scratch3_pen'),
    wedo2: () => require('../extensions/scratch3_wedo2'),
    // move to async library
    // music: () => require('../extensions/scratch3_music'),
    microbit: () => require('../extensions/scratch3_microbit'),
    text2speech: () => require('../extensions/scratch3_text2speech'),
    translate: () => require('../extensions/scratch3_translate'),
    videoSensing: () => require('../extensions/scratch3_video_sensing'),
    ev3: () => require('../extensions/scratch3_ev3'),
    makeymakey: () => require('../extensions/scratch3_makeymakey'),
    boost: () => require('../extensions/scratch3_boost'),
    gdxfor: () => require('../extensions/scratch3_gdx_for'),
    // tw: core extension
    tw: () => require('../extensions/tw')
};

const scratchExtension = [
    'music',
    'pen',
    'videoSensing',
    'text',
    'faceSensing',
    'microbit',
    'text2speech',
    'translate'
];

/** from Gandi extension host */
const officialExtension = {};
/** Extensions loaded by the user */
const customExtension = {};

const reservedExtId = [
    'control', 'event', 'looks',
    'motion', 'operator', 'sound',
    'sensing', 'data', 'procedures',
    'argument', 'ccw', 'Gandi'];

/**
 * @typedef {object} ArgumentInfo - Information about an extension block argument
 * @property {ArgumentType} type - the type of value this argument can take
 * @property {*|undefined} default - the default value of this argument (default: blank)
 */

/**
 * @typedef {object} ConvertedBlockInfo - Raw extension block data paired with processed data ready for scratch-blocks
 * @property {ExtensionBlockMetadata} info - the raw block info
 * @property {object} json - the scratch-blocks JSON definition for this block
 * @property {string} xml - the scratch-blocks XML definition for this block
 */

/**
 * @typedef {object} CategoryInfo - Information about a block category
 * @property {string} id - the unique ID of this category
 * @property {string} name - the human-readable name of this category
 * @property {string|undefined} blockIconURI - optional URI for the block icon image
 * @property {string} color1 - the primary color for this category, in '#rrggbb' format
 * @property {string} color2 - the secondary color for this category, in '#rrggbb' format
 * @property {string} color3 - the tertiary color for this category, in '#rrggbb' format
 * @property {Array.<ConvertedBlockInfo>} blocks - the blocks, separators, etc. in this category
 * @property {Array.<object>} menus - the menus provided by this category
 */

/**
 * @typedef {object} PendingExtensionWorker - Information about an extension worker still initializing
 * @property {string} extensionURL - the URL of the extension to be loaded by this worker
 * @property {Function} resolve - function to call on successful worker startup
 * @property {Function} reject - function to call on failed worker startup
 */

const createExtensionService = extensionManager => {
    const service = {};
    service.registerExtensionServiceSync =
        extensionManager.registerExtensionServiceSync.bind(extensionManager);
    service.allocateWorker =
        extensionManager.allocateWorker.bind(extensionManager);
    service.onWorkerInit = extensionManager.onWorkerInit.bind(extensionManager);
    service.registerExtensionService =
        extensionManager.registerExtensionService.bind(extensionManager);
    return service;
};

// check if func is a class
const isConstructor = value => {
    try {
        // eslint-disable-next-line no-new
        new new Proxy(value, {
            construct () {
                return {};
            }
        })();
        return true;
    } catch (err) {
        return false;
    }
};

class ExtensionManager {
    constructor (vm) {
        /**
         * The ID number to provide to the next extension worker.
         * @type {int}
         */
        this.nextExtensionWorker = 0;

        /**
         * FIFO queue of extensions which have been requested but not yet loaded in a worker,
         * along with promise resolution functions to call once the worker is ready or failed.
         *
         * @type {Array.<PendingExtensionWorker>}
         */
        this.pendingExtensions = [];

        /**
         * Map of worker ID to workers which have been allocated but have not yet finished initialization.
         * @type {Array.<PendingExtensionWorker>}
         */
        this.pendingWorkers = [];

        /**
         * Map of worker ID to the URL where it was loaded from.
         * @type {Array<string>}
         */
        this.workerURLs = [];

        /**
         * Map of loaded extension URLs/IDs (equivalent for built-in extensions) to service name.
         * @type {Map.<string,string>}
         * @private
         */
        this._loadedExtensions = new Map();

        /**
         * Responsible for determining security policies related to custom extensions.
         */
        this.securityManager = new SecurityManager();

        /**
         * @type {VirtualMachine}
         */
        this.vm = vm;

        /**
         * Whether to show a warning that extensions are officially incompatible with Scratch.
         * @type {boolean>}
         */
        this.showCompatibilityWarning = false;

        /**
         * Keep a reference to the runtime so we can construct internal extension objects.
         * @type {Runtime}
         */
        this.runtime = vm.runtime;

        /**
         * List of external extension service URLs that can be loaded remotely.
         * @type {Array.<string>}
         * @private
         */
        this._gandiExternalExtensionServices = [];

        /**
         * Boolean flag to indicate if the external extension services have been loaded.
         * @type {boolean}
         * @private
         */
        this._gandiExternalExtensionServicesLoaded = false;

        this.loadingAsyncExtensions = 0;
        this.asyncExtensionsLoadedCallbacks = [];

        this._customExtensionInfo = {};
        this._officialExtensionInfo = {};
        this.builtinExtensions = Object.assign({}, defaultBuiltinExtensions);

        dispatch.setService('extensions', createExtensionService(this)).catch(e => {
            log.error(`ExtensionManager was unable to register extension service: ${JSON.stringify(e)}`);
        });
    }

    /**
     * Check whether an extension is registered or is in the process of loading. This is intended to control loading or
     * adding extensions so it may return `true` before the extension is ready to be used. Use the promise returned by
     * `loadExtensionURL` if you need to wait until the extension is truly ready.
     * @param {string} extensionID - the ID of the extension.
     * @returns {boolean} - true if loaded, false otherwise.
     */
    isExtensionLoaded (extensionID) {
        return this._loadedExtensions.has(extensionID);
    }

    setLoadedExtension (extensionID, value) {
        const extInfo = this._customExtensionInfo[extensionID] || this._officialExtensionInfo[extensionID];
        if (extInfo && extInfo.url) {
            this.saveWildExtensionsURL(extensionID, extInfo.url);
        }
        this._loadedExtensions.set(extensionID, value);
    }

    registerExtension (extensionId, extension, shouldReplace = false) {
        const loadedExtServiceName = this._loadedExtensions.get(extensionId);
        if (loadedExtServiceName && !shouldReplace) {
            const message = `Rejecting attempt to load a second extension with ID ${extensionId}`;
            log.warn(message);
            return;
        }
        const extensionInstance = isConstructor(extension) ? new extension(this.runtime) : extension;
        if (loadedExtServiceName && shouldReplace) {
            const incomingBlocks = extensionInstance.getInfo().blocks;//It only gets block from extension without the menus.
            const incomingMenus = Object.keys(extensionInstance.getInfo().menus || {});//This can get menus from extension. It's an array of menus' names.
            const incomingOpsSet = new Set(incomingBlocks.map(b => b.opcode).concat(incomingMenus.map(m =>`menu_${m}`)));
            const opsInUseSet = new Set(this.runtime.targets
                .map(({blocks}) => Object.values(blocks._blocks).map(b => b.opcode))
                .flat()
                .filter(op => op.startsWith(`${extensionId}_`))
                .map(op => op.substring(extensionId.length + 1))
            );

            const diff = opsInUseSet.difference(incomingOpsSet);
            if (diff.size > 0) {
                const detail = Array.from(diff);
                log.warn(
                    `Rejecting attempt to replace extension ${extensionId} with new extension that has conflicting opcodes: ${detail.join(',    ')}`
                );
                throw new Error('opcode not found', {
                    cause: {code: 'OPCODE_NOT_FOUND', values: detail}
                });
            }

            const oldBlocks = dispatch.callSync(loadedExtServiceName, 'getInfo').blocks;
            // block type check
            const typeChangedBlocks = oldBlocks.filter(a =>
                incomingBlocks.find(b => opsInUseSet.has(a.opcode) && a.opcode === b.opcode && a.blockType !== b.blockType));
            if (typeChangedBlocks.length > 0) {
                throw new Error(`extension replace fail id = ${extensionId}`, {
                    cause: {code: 'BLOCK_TYPE_CHANGED', values: typeChangedBlocks.map(b => b.opcode)}
                });
            }
            // replace the old extension
            dispatch.setServiceSync(loadedExtServiceName, extensionInstance);
            this.setLoadedExtension(extensionId, loadedExtServiceName);
            this.refreshBlocks(extensionId);
        } else {
            // register new extension
            const serviceName = this._registerInternalExtension(extensionInstance);
            this.setLoadedExtension(extensionId, serviceName);
            this.runtime.compilerRegisterExtension(
                extensionId,
                extensionInstance
            );
        }
        return extensionId;
    }

    /**
     * Determine whether an extension with a given ID is built in to the VM, such as pen.
     * Note that "core extensions" like motion will return false here.
     * @param {string} extensionId
     * @returns {boolean}
     */
    isBuiltinExtension (extensionId) {
        return Object.prototype.hasOwnProperty.call(this.builtinExtensions, extensionId);
    }

    /**
     * Get the list of external extension service URLs.
     * @returns {Array.<string>} - The list of external extension service URLs.
     */
    getGandiExternalExtensionServices () {
        return this._gandiExternalExtensionServices;
    }

    /**
     * Set a new list of external extension service URLs.
     * This also resets the loaded flag to ensure the new services are loaded.
     * @param {Array.<string>} services - The list of new external extension service URLs.
     */
    setGandiExternalExtensionServices (services) {
        this._gandiExternalExtensionServices = services;
        this._gandiExternalExtensionServicesLoaded = false;
    }

    /**
     * Load all external extension services from their URLs.
     * These services are added to the extension library but not loaded into the runtime.
     * @returns {Promise} - A promise that resolves once all external services are loaded.
     * @private
     */
    async loadGandiExternalExtensionServers () {
        const allPromises = this._gandiExternalExtensionServices.map(url => this.loadExternalExtensionToLibrary(url));
        // Only add Gandi remote extensions to the library; don't load them into the runtime. Let the project decide it.
        return Promise.all(allPromises).then(() => {
            this._gandiExternalExtensionServicesLoaded = true;
        });
    }

    /**
     * Synchronously load an internal extension (core or non-core) by ID. This call will
     * fail if the provided id is not does not match an internal extension.
     * @param {string} extensionId - the ID of an internal extension
     */
    loadExtensionIdSync (extensionId) {
        if (!this.isBuiltinExtension(extensionId)) {
            log.warn(`Could not find extension ${extensionId} in the built in extensions.`);
            return;
        }
        /** @TODO dupe handling for non-builtin extensions. See commit 670e51d33580e8a2e852b3b038bb3afc282f81b9 */
        if (this.isExtensionLoaded(extensionId)) {
            const message = `Rejecting attempt to load a second extension with ID ${extensionId}`;
            log.warn(message);
            return;
        }
        const extension = this.builtinExtensions[extensionId]();
        return this.registerExtension(extensionId, extension);
    }

    addBuiltinExtension (extensionId, extensionClass) {
        this.builtinExtensions[extensionId] = () => extensionClass;
    }

    _isValidExtensionURL (extensionURL) {
        try {
            const parsedURL = new URL(extensionURL);
            return (
                parsedURL.protocol === 'https:' ||
                parsedURL.protocol === 'http:' ||
                parsedURL.protocol === 'data:' ||
                parsedURL.protocol === 'file:'
            );
        } catch (e) {
            return false;
        }
    }

    /**
     * Load an extension by URL or internal extension ID
     * @param {string} extensionURL - the URL for the extension to load OR the ID of an internal extension
     * @param {bool} shouldReplace - should replace extension that already loaded
     * @returns {Promise} resolved once the extension is loaded and initialized or rejected on failure
     */
    async loadExtensionURL (extensionURL, shouldReplace = false) {
        if (!extensionURL) {
            throw new Error('extension Id is null');
        }
        if (this.isBuiltinExtension(extensionURL)) {
            return this.loadExtensionIdSync(extensionURL);
        }

        if (this.isExternalExtension(extensionURL)) {
            return this.loadExternalExtensionById(extensionURL, shouldReplace);
        }

        let extFileURL = extensionURL;
        if (!this.isValidExtensionURL(extensionURL)) {
            const wildExt = this.runtime.gandi.wildExtensions[extensionURL];
            extFileURL = wildExt ? wildExt.url : '';
        }

        if (!extFileURL && this.runtime.ccwAPI.getExtensionURLById) {
            // try get extension url from ccwAPI
            // NOTE: issue - may get a extension which id is same but not compatible with current blocks
            // TODO: let user choose which load it or input a new URL
            extFileURL = await this.runtime.ccwAPI.getExtensionURLById(extensionURL);
        }

        if (this.isValidExtensionURL(extFileURL)) {
            if (this.isExtensionURLLoaded(extensionURL) && !shouldReplace) {
                // Extension is already loaded.
                // TODO: should let user choose if they want to reload it?
                return;
            }
            return this.loadExternalExtensionToLibrary(extFileURL, shouldReplace).then(({onlyAdded, addedAndLoaded}) => {
                const allLoader = onlyAdded.map(extId => this.loadExternalExtensionById(extId, shouldReplace));
                return Promise.all(allLoader).then(res => res.concat(addedAndLoaded).flat());
            });
        }
        log.error(` load extension failed Id: ${extensionURL}, URL: `, extFileURL);
        // EXTENSION_NOT_FOUND
        this.runtime.emit('EXTENSION_NOT_FOUND', extensionURL);
        throw new Error(`Extension not found: ${extensionURL}`);
    }

    /**
     * Loads an extension URL in a worker.
     *
     * @param {string} extensionURL - The URL of the extension to load.
     * @returns {Promise} A promise that resolves when the extension is loaded successfully, or rejects with an error if the extension is not found.
     */
    loadExtensionURLInWorker (extensionURL) {
        this.loadingAsyncExtensions++;
        return new Promise((resolve, reject) => {
            this.pendingExtensions.push({extensionURL, resolve, reject});
            this.createExtensionWorker()
                .then(worker => dispatch.addWorker(worker))
                .then(extensionURL)
                .catch(_error => {
                    this.runtime.emit('EXTENSION_NOT_FOUND', extensionURL);
                    log.error(_error);
                    return reject(_error);
                });
        }).finally(() => this.runtime.emit('EXTENSION_DATA_LOADING', false));
    }

    /**
     * Wait until all async extensions have loaded
     * @returns {Promise} resolved when all async extensions have loaded
     */
    async allAsyncExtensionsLoaded () {
        if (!this._gandiExternalExtensionServicesLoaded) {
            try {
                await this.loadGandiExternalExtensionServers();
            } catch (error) {
                throw new Error('Failed to load additional Gandi extension services');
            }
        }
        if (this.loadingAsyncExtensions === 0) {
            return;
        }
        return new Promise((resolve, reject) => {
            this.asyncExtensionsLoadedCallbacks.push({
                resolve,
                reject
            });
        });
    }

    /**
     * Creates a new extension worker.
     * @returns {Promise}
     */
    createExtensionWorker () {
        if (this.workerMode === 'worker') {
            // eslint-disable-next-line max-len
            const ExtensionWorker = require('worker-loader?inline=true!./extension-worker');
            return Promise.resolve(new ExtensionWorker());
        } else if (this.workerMode === 'iframe') {
            return import(
                /* webpackChunkName: "iframe-extension-worker" */ './tw-iframe-extension-worker'
            ).then(mod => new mod.default());
        }
        return Promise.reject(new Error('Unknown extension worker mode'));
    }

    /**
     * Remove all extensions from services.
     * If we don't do so, this will cause memory leak on Single Page Application.
     */
    disposeExtensionServices () {
        Object.keys(dispatch.services).forEach(serviceName => {
            if (/^extension_\d+_/.test(serviceName)) {
                delete dispatch.services[serviceName];
            }
        });
    }

    /**
     * Regenerate blockinfo for any loaded extensions
     * @returns {Promise} resolved once all the extensions have been reinitialized
     */
    refreshBlocks (targetServiceName) {
        const refreshExtension = serviceName =>
            dispatch
                .call(serviceName, 'getInfo')
                .then(info => {
                    info = this._prepareExtensionInfo(serviceName, info);
                    dispatch.call(
                        'runtime',
                        '_refreshExtensionPrimitives',
                        info
                    );
                })
                .catch(e => {
                    log.error(
                        `Failed to refresh built-in extension primitives: ${JSON.stringify(
                            e
                        )}`
                    );
                });

        if (targetServiceName) {
            const isExisted = Array.from(this._loadedExtensions.values()).find(
                name => name === targetServiceName
            );
            if (isExisted) {
                return refreshExtension(targetServiceName);
            }
        }

        const allPromises = Array.from(this._loadedExtensions.values()).map(
            serviceName => refreshExtension(serviceName)
        );
        return Promise.all(allPromises);
    }

    allocateWorker () {
        const id = this.nextExtensionWorker++;
        const workerInfo = this.pendingExtensions.shift();
        this.pendingWorkers[id] = workerInfo;
        this.workerURLs[id] = workerInfo.extensionURL;
        return [id, workerInfo.extensionURL];
    }

    /**
     * Synchronously collect extension metadata from the specified service and begin the extension registration process.
     * @param {string} serviceName - the name of the service hosting the extension.
     */
    registerExtensionServiceSync (serviceName) {
        const info = dispatch.callSync(serviceName, 'getInfo');
        this._registerExtensionInfo(serviceName, info);
    }

    /**
     * Collect extension metadata from the specified service and begin the extension registration process.
     * @param {string} serviceName - the name of the service hosting the extension.
     */
    registerExtensionService (serviceName) {
        dispatch.call(serviceName, 'getInfo').then(info => {
            this.setLoadedExtension(info.id, serviceName);
            this._registerExtensionInfo(serviceName, info);
            this._finishedLoadingExtensionScript();
        });
    }

    _finishedLoadingExtensionScript () {
        this.loadingAsyncExtensions--;
        if (this.loadingAsyncExtensions === 0) {
            this.asyncExtensionsLoadedCallbacks.forEach(i => i.resolve());
            this.asyncExtensionsLoadedCallbacks = [];
        }
    }

    _failedLoadingExtensionScript (error) {
        // Don't set the current extension counter to 0, otherwise it will go negative if another
        // extension finishes or fails to load.
        this.loadingAsyncExtensions--;
        this.asyncExtensionsLoadedCallbacks.forEach(i => i.reject(error));
        this.asyncExtensionsLoadedCallbacks = [];
        // Re-throw error so the promise still rejects.
        throw error;
    }

    /**
     * Called by an extension worker to indicate that the worker has finished initialization.
     * @param {int} id - the worker ID.
     * @param {*?} e - the error encountered during initialization, if any.
     */
    onWorkerInit (id, e) {
        const workerInfo = this.pendingWorkers[id];
        delete this.pendingWorkers[id];
        if (e) {
            this.loadingAsyncExtensions = 0;
            workerInfo.reject(e);
        } else {
            workerInfo.resolve();
        }
    }

    /**
     * Register an internal (non-Worker) extension object
     * @param {object} extensionObject - the extension object to register
     * @returns {string} The name of the registered extension service
     */
    _registerInternalExtension (extensionObject) {
        const extensionInfo = extensionObject.getInfo();
        const fakeWorkerId = this.nextExtensionWorker++;
        const serviceName = `extension_${fakeWorkerId}_${extensionInfo.id}`;
        dispatch.setServiceSync(serviceName, extensionObject);
        dispatch.callSync(
            'extensions',
            'registerExtensionServiceSync',
            serviceName
        );
        return serviceName;
    }

    /**
     * Sanitize extension info then register its primitives with the VM.
     * @param {string} serviceName - the name of the service hosting the extension
     * @param {ExtensionInfo} extensionInfo - the extension's metadata
     * @private
     */
    _registerExtensionInfo (serviceName, extensionInfo) {
        extensionInfo = this._prepareExtensionInfo(serviceName, extensionInfo);
        dispatch
            .call('runtime', '_registerExtensionPrimitives', extensionInfo)
            .catch(e => {
                log.error(
                    `Failed to register primitives for extension on service ${serviceName}:`,
                    e
                );
            });
    }

    /**
     * Apply minor cleanup and defaults for optional extension fields.
     * TODO: make the ID unique in cases where two copies of the same extension are loaded.
     * @param {string} serviceName - the name of the service hosting this extension block
     * @param {ExtensionInfo} extensionInfo - the extension info to be sanitized
     * @returns {ExtensionInfo} - a new extension info object with cleaned-up values
     * @private
     */
    _prepareExtensionInfo (serviceName, extensionInfo) {
        extensionInfo = Object.assign({}, extensionInfo);
        // Allowed ID characters are those matching the regular expression [\w-.]: A-Z, a-z, 0-9, hyphen ("-") and dot (".") .
        if (/[^\w-.]/i.test(extensionInfo.id)) {
            throw new Error('Invalid extension id');
        }
        if (
            !scratchExtension.includes(extensionInfo.id) &&
            this.showCompatibilityWarning
        ) {
            const warningTipText =
                extensionInfo.warningTipText ||
                this.runtime.getFormatMessage()({
                    id: 'gui.extension.compatibilityWarning',
                    default:
                        'This extension is incompatible with Original Scratch.',
                    description:
                        'Give a warning when an extension is not official in Scratch.'
                });
            extensionInfo.warningTipText = warningTipText;
        } else {
            delete extensionInfo.warningTipText;
        }
        extensionInfo.name = extensionInfo.name || extensionInfo.id;
        extensionInfo.blocks = extensionInfo.blocks || [];
        extensionInfo.targetTypes = extensionInfo.targetTypes || [];
        extensionInfo.blocks = extensionInfo.blocks.reduce(
            (results, blockInfo) => {
                try {
                    let result;
                    if (
                        typeof blockInfo === 'string' &&
                        blockInfo.startsWith('---')
                    ) {
                        result = blockInfo;
                    } else {
                        result = this._prepareBlockInfo(serviceName, blockInfo);
                    }
                    results.push(result);
                } catch (e) {
                    // TODO: more meaningful error reporting
                    log.error(
                        `Error processing block: ${
                            e.message
                        }, Block:\n${JSON.stringify(blockInfo)}`
                    );
                }
                return results;
            },
            []
        );
        extensionInfo.menus = extensionInfo.menus || {};
        extensionInfo.menus = this._prepareMenuInfo(
            serviceName,
            extensionInfo.menus
        );
        return extensionInfo;
    }

    /**
     * Prepare extension menus. e.g. setup binding for dynamic menu functions.
     * @param {string} serviceName - the name of the service hosting this extension block
     * @param {Array.<MenuInfo>} menus - the menu defined by the extension.
     * @returns {Array.<MenuInfo>} - a menuInfo object with all preprocessing done.
     * @private
     */
    _prepareMenuInfo (serviceName, menus) {
        const menuNames = Object.getOwnPropertyNames(menus);
        for (let i = 0; i < menuNames.length; i++) {
            const menuName = menuNames[i];
            let menuInfo = menus[menuName];

            // If the menu description is in short form (items only) then normalize it to general form: an object with
            // its items listed in an `items` property.
            if (!menuInfo.items) {
                menuInfo = {
                    items: menuInfo
                };
                menus[menuName] = menuInfo;
            }
            // If `items` is a string, it should be the name of a function in the extension object. Calling the
            // function should return an array of items to populate the menu when it is opened.
            if (typeof menuInfo.items === 'string') {
                const menuItemFunctionName = menuInfo.items;
                const serviceObject = dispatch.services[serviceName];
                // Bind the function here so we can pass a simple item generation function to Scratch Blocks later.
                menuInfo.items = this._getExtensionMenuItems.bind(
                    this,
                    serviceObject,
                    menuItemFunctionName
                );
            }
        }
        return menus;
    }

    /**
     * Fetch the items for a particular extension menu, providing the target ID for context.
     * @param {object} extensionObject - the extension object providing the menu.
     * @param {string} menuItemFunctionName - the name of the menu function to call.
     * @returns {Array} menu items ready for scratch-blocks.
     * @private
     */
    _getExtensionMenuItems (extensionObject, menuItemFunctionName) {
        // Fetch the items appropriate for the target currently being edited. This assumes that menus only
        // collect items when opened by the user while editing a particular target.
        const editingTarget =
            this.runtime.getEditingTarget() || this.runtime.getTargetForStage();
        const editingTargetID = editingTarget ? editingTarget.id : null;
        const extensionMessageContext =
            this.runtime.makeMessageContextForTarget(editingTarget);

        // TODO: Fix this to use dispatch.call when extensions are running in workers.
        const menuFunc = extensionObject[menuItemFunctionName];
        const menuItems = menuFunc
            .call(extensionObject, editingTargetID)
            // add dynamic menu items from gandi, such as custom skeleton or async asset
            .concat(
                this.runtime.gandi.dynamicMenuItems[menuItemFunctionName] ?? []
            )
            .map(item => {
                item = maybeFormatMessage(item, extensionMessageContext);
                switch (typeof item) {
                case 'object':
                    return [
                        maybeFormatMessage(
                            item.text,
                            extensionMessageContext
                        ),
                        item.value
                    ];
                case 'string':
                    return [item, item];
                default:
                    return item;
                }
            });

        if (!menuItems || menuItems.length < 1) {
            throw new Error(
                `Extension menu returned no items: ${menuItemFunctionName}`
            );
        }
        return menuItems;
    }

    /**
     * Apply defaults for optional block fields.
     * @param {string} serviceName - the name of the service hosting this extension block
     * @param {ExtensionBlockMetadata} blockInfo - the block info from the extension
     * @returns {ExtensionBlockMetadata} - a new block info object which has values for all relevant optional fields.
     * @private
     */
    _prepareBlockInfo (serviceName, blockInfo) {
        if (blockInfo.blockType === BlockType.XML) {
            blockInfo = Object.assign({}, blockInfo);
            blockInfo.xml = String(blockInfo.xml) || '';
            return blockInfo;
        }

        blockInfo = Object.assign({}, {
            blockType: BlockType.COMMAND,
            terminal: false,
            blockAllThreads: false,
            arguments: {}
        }, blockInfo);
        blockInfo.text = blockInfo.text || blockInfo.opcode;

        switch (blockInfo.blockType) {
        case BlockType.EVENT:
            if (blockInfo.func) {
                log.warn(
                    `Ignoring function "${blockInfo.func}" for event block ${blockInfo.opcode}`
                );
            }
            break;
        case BlockType.BUTTON:
            if (blockInfo.opcode) {
                log.warn(
                    `Ignoring opcode "${blockInfo.opcode}" for button with text: ${blockInfo.text}`
                );
            }
            blockInfo.callFunc = () => {
                dispatch.call(serviceName, blockInfo.func);
            };
            break;
        case BlockType.LABEL:
            if (blockInfo.opcode) {
                log.warn(`Ignoring opcode "${blockInfo.opcode}" for label: ${blockInfo.text}`);
            }
            break;
        default: {
            if (!blockInfo.opcode) {
                throw new Error('Missing opcode for block');
            }

            const funcName = blockInfo.func || blockInfo.opcode;

            const getBlockInfo = blockInfo.isDynamic ?
                args => args && args.mutation && args.mutation.blockInfo :
                () => blockInfo;
            const callBlockFunc = (() => {
                if (dispatch._isRemoteService(serviceName)) {
                    return (args, util, realBlockInfo) =>
                        dispatch.call(serviceName, funcName, args, util, realBlockInfo)
                            .then(result => {
                                // Scratch is only designed to handle these types.
                                // If any other value comes in such as undefined, null, an object, etc.
                                // we'll convert it to a string to avoid undefined behavior.
                                if (
                                    typeof result === 'number' ||
                                    typeof result === 'string' ||
                                    typeof result === 'boolean'
                                ) {
                                    return result;
                                }
                                return `${result}`;
                            });
                }

                // avoid promise latency if we can call direct
                const serviceObject = dispatch.services[serviceName];
                if (!serviceObject[funcName]) {
                    // The function might show up later as a dynamic property of the service object
                    log.warn(
                        `Could not find extension block function called ${funcName}`
                    );
                }

                return (args, util, realBlockInfo) => {
                    if (serviceObject[funcName]) {
                        return serviceObject[funcName](
                            args,
                            util,
                            realBlockInfo
                        );
                    }
                    log.error(
                        `Warning: the method '${funcName}' in the ${serviceObject.constructor.name} has not been implemented yet.`
                    );
                };
            })();

            blockInfo.func = (args, util) => {
                const realBlockInfo = getBlockInfo(args);
                // TODO: filter args using the keys of realBlockInfo.arguments? maybe only if sandboxed?
                return callBlockFunc(args, util, realBlockInfo);
            };
            break;
        }
        }

        return blockInfo;
    }

    /**
     * @description register gandi extension when developer load custom extension
     * @param {string} id extension id
     * @param {string} url extension url
     */
    saveWildExtensionsURL (id, url) {
        this.runtime.gandi.addWildExtension({id, url});
        // check if wild extension js is in sb3 assets
        if (this.runtime.gandi.isExtensionURLInGandiAssets(url)) {
            const extInfo = this._customExtensionInfo[id] || this._officialExtensionInfo[id];
            extInfo.replaceable = true;
        }
    }

    loadExternalExtensionById (extensionId, shouldReplace = false) {
        if (this.isExtensionLoaded(extensionId) && !shouldReplace) {
            // avoid init extension twice if it already loaded
            return;
        }
        setupScratchAPI(this.vm, extensionId);
        return this.getExternalExtensionConstructor(extensionId)
            .then(extension => this.registerExtension(extensionId, extension, shouldReplace))
            .finally(() => {
                clearScratchAPI(extensionId);
            });
    }

    isValidExtensionURL (extensionURL) {
        try {
            const parsedURL = new URL(extensionURL);
            return (
                parsedURL.protocol === 'https:' ||
                parsedURL.protocol === 'http:'
            );
        } catch (e) {
            return false;
        }
    }

    injectExtension (extensionId, extension) {
        this.builtinExtensions[extensionId] = () => extension;
    }

    isExternalExtension (extensionId) {
        return (
            Object.hasOwnProperty.call(officialExtension, extensionId) ||
            Object.hasOwnProperty.call(customExtension, extensionId)
        );
    }

    clearLoadedExtensions () {
        this._loadedExtensions.clear();
    }

    addOfficialExtensionInfo (obj) {
        const {Extension, ...ext} = obj;
        const extensionId = ext.info && ext.info.extensionId;
        if (!extensionId) {
            throw new Error('extensionId not found, add extensionInfo failed');
        }

        this._officialExtensionInfo[extensionId] = ext;
        officialExtension[extensionId] = Extension;
    }

    addCustomExtensionInfo (obj, url) {
        const {Extension, ...ext} = obj;
        const extensionId = ext.info && ext.info.extensionId;
        if (!extensionId) {
            throw new Error('extensionId is null in extensionInfo');
        }
        if (this.isExtensionIdReserved(extensionId)) {
            throw new Error(`extensionId: '${extensionId}' is reserved in Scratch, please change another one.`);
        }
        if (url) {
            ext.url = url;
        }
        this._customExtensionInfo[extensionId] = ext;
        if (isConstructor(Extension)) {
            customExtension[extensionId] = () => Extension;
        } else {
            customExtension[extensionId] = Extension;
        }
    }

    updateExternalExtensionConstructor (extensionId, func) {
        // only exts from gandi ext service need update constructor when it is a IIFE
        if (officialExtension[extensionId]) {
            officialExtension[extensionId] = func;
        }
    }

    async getExternalExtensionConstructor (extensionId) {
        const externalExt = {
            ...officialExtension,
            ...customExtension
        };
        const func = externalExt[extensionId];
        if (typeof func === 'function') {
            // all extension is warp in a function, so we need to call it to get the extension class
            // it returns has three possibility by different extension source or template
            const extClass = await func();
            if (
                extClass &&
                extClass.__esModule &&
                extClass.default &&
                isConstructor(extClass.default)
            ) {
                // 1. return a es modules which from gandi ext lib
                // cache the constructor
                externalExt[extensionId] = () => extClass.default;
                return extClass.default;
            } else if (isConstructor(extClass)) {
                // 2. return a constructor
                return extClass;
            }
            // 3. return a IIFE which called global Scratch.extensions.register to register
            //      extension obj will be added in IIFEExtensionInfoList
            const needRegister = global.IIFEExtensionInfoList &&
            global.IIFEExtensionInfoList.find(({extensionObject}) => extensionObject.info.extensionId === extensionId);
            if (needRegister) {
                // update extension constructor
                this.updateExternalExtensionConstructor(extensionId, needRegister.extensionObject.Extension);
                return needRegister.extensionInstance;
            }
        }
        throw new Error(`Extension not found: ${extensionId}`);
    }

    /**
     * Loads an external extension to the library.
     *
     * @param {string} url - The URL of the external extension.
     * @param {boolean} [shouldReplace=false] - Whether to replace existing extensions with the same ID.
     * @param {boolean} [disallowIIFERegister=false] - Whether to disallow registering extensions using IIFE.
     * @returns {Promise<{onlyAdded: string[], addedAndLoaded: string[]}>} - A promise that resolves with an object containing two arrays: `onlyAdded` and `addedAndLoaded`.
     * - `onlyAdded` contains the IDs of the extensions that were only added to the library.
     * - `addedAndLoaded` contains the IDs of the extensions that were both added to the library and loaded.
     * @throws {Error} - If an error occurs while loading the extension.
     */
    async loadExternalExtensionToLibrary (url, shouldReplace = false, disallowIIFERegister = false) {
        const onlyAdded = [];
        const addedAndLoaded = []; // exts use Scratch.extensions.register
        const rewritten = await this.securityManager.rewriteExtensionURL(url);
        return new Promise((resolve, reject) => {
            setupScratchAPI(this.vm, rewritten);
            createdScriptLoader({
                url: rewritten,
                onSuccess: async () => {
                    try {
                        if (global.IIFEExtensionInfoList) {
                        // for those extension which registered by scratch.extensions.register in IIFE
                            global.IIFEExtensionInfoList.forEach(({extensionObject, extensionInstance}) => {
                                this.addCustomExtensionInfo(extensionObject, url);
                                if (disallowIIFERegister) {
                                    onlyAdded.push(extensionObject.info.extensionId);
                                } else {
                                    this.registerExtension(extensionObject.info.extensionId, extensionInstance, shouldReplace);
                                    addedAndLoaded.push(extensionObject.info.extensionId);
                                }
                            });
                        }
                        if (global.ExtensionLib) {
                        // for those extension which developed by user using ccw-customExt-tool
                            const lib = await global.ExtensionLib;
                            Object.keys(lib).forEach(key => {
                                const obj = lib[key];
                                this.addCustomExtensionInfo(obj, url);
                                onlyAdded.push(obj.info.extensionId);
                            });
                            delete global.ExtensionLib;
                        }
                        if (global.tempExt) {
                        // for user developing custom extension
                            const obj = global.tempExt;
                            this.addCustomExtensionInfo(obj, url);
                            onlyAdded.push(obj.info.extensionId);
                            delete global.tempExt;
                        }
                        if (global.scratchExtensions) {
                        // for Gandi extension service
                            const {default: lib} =
                            await global.scratchExtensions.default();
                            Object.entries(lib).forEach(([key, obj]) => {
                                if (!(obj.info && obj.info.extensionId)) {
                                // compatible with some legacy gandi extension service
                                    obj.info = obj.info || {};
                                    obj.info.extensionId = key;
                                }
                                this.addOfficialExtensionInfo(obj);
                                onlyAdded.push(obj.info && obj.info.extensionId);
                            });
                        }
                        resolve({onlyAdded, addedAndLoaded});
                    } catch (error) {
                        reject(error);
                    }
                },
                onError: reject
            });
        })
            // .catch(e => log.error('LoadRemoteExtensionError: ', e))
            .finally(() => {
                clearScratchAPI(url);
                if (onlyAdded.length > 0 || addedAndLoaded.length > 0) {
                    this.runtime.emit('EXTENSION_LIBRARY_UPDATED');
                }
                delete global.scratchExtensions;
                delete global.tempExt;
                delete global.ExtensionLib;
                delete global.IIFEExtensionInfoList;
            });
    }


    /**
     * Checks if an extension ID is reserved.
     *
     * @param {string} extensionId - The extension ID to check.
     * @returns {boolean} - Returns `false` if the extension ID is not reserved, `true` otherwise.
     */
    isExtensionIdReserved (extensionId) {
        if (reservedExtId.includes(extensionId)) {
            return true;
        }
        if (reservedExtId.find(prefix => extensionId.startsWith(`${prefix}_`))) {
            return true;
        }
        return false;
    }

    getLoadedExtensionURLs () {
        const loadURLs = {};
        Array.from(this._loadedExtensions.keys()).forEach(extId => {
            const ext = this._customExtensionInfo[extId] || this._officialExtensionInfo[extId];
            if (ext && ext.url) {
                loadURLs[extId] = ext.url;
            }
        })
        return loadURLs;
    }

    deleteExtensionById (extensionId) {
        const inUseBlockOps = new Set(this.runtime.targets
            .map(({blocks}) => Object.values(blocks._blocks).map(b => b.opcode))
            .flat()
            .filter(op => op.startsWith(`${extensionId}_`))
            .map(op => op.substring(extensionId.length + 1))
        );
        if (inUseBlockOps.size > 0) {
            throw new Error(`delete extension failed id=${extensionId}`, {
                cause: {code: 'OPCODE_IN_USE', values: Array.from(inUseBlockOps)}
            });
        }

        // delete extension service
        const serviceName = this._loadedExtensions.get(extensionId);
        delete dispatch.services[serviceName];
        this._loadedExtensions.delete(extensionId);
        // delete extension info
        delete this._customExtensionInfo[extensionId];
        delete customExtension[extensionId];
        // delete as wild extension if it is
        this.runtime.gandi.deleteWildExtension(extensionId);
        // delete extension in runtime
        this.runtime.removeExtensionPrimitives(extensionId);

        // delete monitor if extension has
        this.runtime.getMonitorState()
            .filter(monitorData => monitorData.opcode.startsWith(`${extensionId}_`))
            .forEach(monitorData => {
                this.runtime.monitorBlocks.deleteBlock(monitorData.id);
                this.runtime.requestRemoveMonitor(monitorData.id);
            });
        // delete a extension should change project to unsaved
        this.runtime.emitProjectChanged();
    }

    getReplaceableExtensionInfo () {
        const allExtInfo = {...this._customExtensionInfo,
            ...this._officialExtensionInfo};
        const allReplaceable = Object.values(allExtInfo).filter(ext => ext.replaceable);
        const allLoaded = Array.from((this._loadedExtensions.keys()));
        return allReplaceable.filter(elem => allLoaded.includes(elem.info.extensionId));
    }

    getExtensionInfoById (extensionId) {
        return this._customExtensionInfo[extensionId] || this._officialExtensionInfo[extensionId];
    }

    replaceExtensionWithId (newId, oldId) {
        const runtime = this.runtime;
        const incomingExt = runtime._blockInfo.find(block => block.id === newId);
        const incomingBlocks = incomingExt.blocks;
        const incomingOpsSet = new Set(incomingBlocks.map(b => b.info.opcode).filter(Boolean));

        const oldExt = runtime._blockInfo.find(block => block.id === oldId);

        const currOpsSet = new Set(
            runtime.targets
                .map(({blocks}) => Object.values(blocks._blocks).map(b => b.opcode))
                .flat()
                .filter(op => op.startsWith(`${oldExt.id}_`))
                .map(op => op.substring(oldExt.id.length + 1))
        );
        const diff = currOpsSet.difference(incomingOpsSet);
        if (diff.size > 0) {
            // opcode in use are not fully match,revert replacement
            this.deleteExtensionById(incomingExt.id);
            throw new Error(`opcodes are not fully covered in new extension ${incomingExt.id}`, {
                cause: {code: 'OPCODE_NOT_FOUND', values: Array.from(diff)}
            });
        } else {
            // TODO: allow type change, auto fix all block connection error cause by type change
            const typeChangedBlocks = oldExt.blocks.filter(a => incomingBlocks.find(b => {
                if (a.info && b.info) {
                    return a.info.opcode === b.info.opcode && a.info.blockType !== b.info.blockType;
                }
                return false;
            }));
            if (typeChangedBlocks.length > 0) {
                throw new Error(`extension replace fail new = ${newId} old=${oldId}`, {
                    cause: {code: 'BLOCK_TYPE_CHANGED', values: typeChangedBlocks.map(b => b.info.opcode)}
                });
            }
            // do fully replace
            runtime.targets.forEach(
                ({blocks}) => Object.values(blocks._blocks).forEach(
                    b => {
                        if (b.opcode.startsWith(`${oldExt.id}_`)) {
                            b.opcode = `${incomingExt.id}_${b.opcode.substring(oldExt.id.length + 1)}`;
                        }
                    }
                )
            );
            // reset cache
            runtime.resetAllCaches();
            this.deleteExtensionById(oldExt.id);
        }
    }

    isExtensionURLLoaded (extensionURL) {
        const all = this.getLoadedExtensionURLs()
        return Object.values(all).includes(extensionURL);
    }
    getExtensionURLs () {
        return this.getLoadedExtensionURLs();
    }
}

module.exports = ExtensionManager;
