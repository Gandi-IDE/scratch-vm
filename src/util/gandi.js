const uid = require('../util/uid');
const log = require('../util/log');
class Gandi {
    /**
     * Constructor for the Gandi class.
     * @constructor
     * @param {Object} runtime - The runtime object.
     */
    constructor (runtime) {
        /**
         * The runtime object.
         * @member {Object}
         */
        this.runtime = runtime;

        /**
         * Array to store properties.
         * @member {Array}
         */
        this.properties = ['assets', 'wildExtensions', 'configs', 'dynamicMenuItems', 'spine'];
        // const AssetType = runtime.storage.AssetType;
        /**
         * default supported asset types
         */
        this._supportedAssetTypes = [];
        this.setup();
    }

    merge (data) {
        if (!data) {
            return null;
        }
        if (data.configs) {
            this.configs = Object.assign(this.configs || {}, data.configs);
        }
        if (data.wildExtensions) {
            this.wildExtensions = Object.assign(this.wildExtensions || {}, data.wildExtensions);
        }
        if (data.dynamicMenuItems) {
            this.dynamicMenuItems = Object.assign(this.dynamicMenuItems || {}, data.dynamicMenuItems);
        }
        if (data.spine) {
            this.spine = Object.assign(this.spine || {}, data.spine);
        }

        // Check if the asset is a duplicate
        const isDuplicateAsset = b =>
            this.assets.find(obj => obj.name === b.name && obj.dataFormat === b.dataFormat && obj.md5 === b.md5);

        const isDuplicateFilename = fileName =>
            this.assets.find(obj => `${obj.name}.${obj.dataFormat}` === fileName);

        const isDuplicateId = id =>
            this.assets.find(obj => obj.id === id);

        // TODO: should allow duplicate asset content but not the same assetId?
        const newAssets = data.assets.filter(obj => !isDuplicateAsset(obj));
        newAssets.forEach(obj => {
            let newName = `${obj.name}`;
            let filename = `${newName}.${obj.dataFormat}`;
            let i = 1;
            while (isDuplicateFilename(filename)) {
                i++;
                newName = `${obj.name}_${i}`;
                filename = `${newName}.${obj.dataFormat}`;
            }
            if (i > 1) {
                log.warn(`Duplicate asset found: ${obj.name}.${obj.dataFormat}. Renaming to ${newName}.${obj.dataFormat}`);
                obj.name = newName;
            }
            if (isDuplicateId(obj.id)) {
                log.warn(`Duplicate asset id found: ${obj.id}. Regenerating id`);
                obj.id = uid();
            }
        });
        this.assets = this.assets.concat(newAssets);

        return {assets: newAssets, wildExtensions: data.wildExtensions};
    }

    setup () {
        /**
         * Array to store assets.
         * @member {Array}
         */
        this.assets = [];

        /**
         * Object to store wild extensions.
         * @member {Object}
         */
        this.wildExtensions = {};

        /**
         * Object to store configurations.
         * @member {Object}
         */
        this.configs = {};

        /**
         * Object to store dynamic menu items.
         * @member {Object}
         */
        this.dynamicMenuItems = {};

        /**
         * Object to store spine data.
         * @member {Object}
         */
        this.spine = {
            heroes: {
                atlas: 'heroes.atlas',
                json: 'heroes.json'
            },
            scratchCat: {
                atlas: 'ScratchCat.atlas',
                json: 'ScratchCat.json'
            }
        };
    }

    get supportedAssetTypes () {
        return this._supportedAssetTypes;
    }

    set supportedAssetTypes (types) {
        // now support only works before loading assets
        // change supported asset types after loading assets will not change existed assets
        // maybe it needs to reload assets in the future
        this._supportedAssetTypes = types;
    }

    clear () {
        this.setup();
    }

    /**
     * Checks if all properties are empty.
     * @method
     * @returns {boolean} - True if all properties are empty, false otherwise.
     */
    isEmpty () {
        return this.properties.every(key => this.isEmptyObject(this[key]));
    }

    /**
     * Checks if a specific property is empty.
     * @method
     * @param {string} propertyName - The name of the property to check.
     * @returns {boolean} - True if the property is empty, false otherwise.
     */
    istPropertyEmpty (propertyName) {
        return this.isEmptyObject(this[propertyName]);
    }

    /**
     * Serializes Gandi assets.
     * @method
     * @param {Set} extensions - Set of extensions.
     * @returns {Array} - Serialized Gandi assets.
     */
    serializeGandiAssets (extensions) {
        return this.assets.reduce(
            (acc, gandiAsset) => {
                const item = Object.create(null);
                item.id = gandiAsset.id;
                item.assetId = gandiAsset.assetId;
                item.name = gandiAsset.name;
                item.md5ext = gandiAsset.md5;
                item.dataFormat = gandiAsset.dataFormat.toLowerCase();
                if (item.dataFormat === 'py') {
                    // py and json file need GandiPython extension to run
                    extensions.add('GandiPython');
                }
                return [...acc, item];
            }, []
        );
    }

    /**
     * Checks if an object is empty.
     * @method
     * @param {Object} object - The object to check.
     * @returns {boolean} - True if the object is empty, false otherwise.
     */
    isEmptyObject (object) {
        return typeof object === 'object' ?
            Object.keys(object).length === 0 :
            Boolean(object);
    }

    /**
     * Serializes Gandi data.
     * @method
     * @param {Object} object - The object to serialize.
     * @param {Set} extensions - Set of extensions.
     */
    serialize (extensions) {
        let gandiObj;
        const hasSpine = extensions.has('GandiSpineSkeleton');
        const usedExt = {};
        Object.values(this.wildExtensions).forEach(ext => {
            if (extensions.has(ext.id)) {
                usedExt[ext.id] = ext;
            }
        });
        if (usedExt && Object.keys(usedExt).length > 0) {
            gandiObj = Object.assign(gandiObj || {}, {wildExtensions: usedExt});
        }
        if (hasSpine) {
            gandiObj = Object.assign(gandiObj || {}, {spine: this.spine});
        }
        if (this.dynamicMenuItems && Object.keys(this.dynamicMenuItems).length > 0) {
            gandiObj = Object.assign(gandiObj || {}, {dynamicMenuItems: this.dynamicMenuItems});
        }
        if (this.configs && Object.keys(this.configs).length > 0) {
            gandiObj = Object.assign(gandiObj || {}, {configs: this.configs});
        }
        const assets = this.serializeGandiAssets(extensions);
        if (assets.length > 0) {
            gandiObj = Object.assign(gandiObj || {}, {assets});
        }
        return gandiObj;
    }

    /**
     * Adds a Spine asset.
     * @method
     * @param {string} key - The key for the Spine asset.
     * @param {Object} data - The data for the Spine asset.
     */
    addSpineAsset (key, data) {
        if (!this.spine[key]) {
            this.spine[key] = data;
            this.runtime.emitGandiSpineUpdate('add', key, data);
            this.runtime.emitProjectChanged();
        }
    }

    /**
     * Deletes a Spine asset.
     * @method
     * @param {string} key - The key of the Spine asset to delete.
     */
    deleteSpineAsset (key) {
        if (this.spine[key]) {
            delete this.spine[key];
            this.runtime.emitGandiSpineUpdate('delete', key);
            this.runtime.emitProjectChanged();
        }
    }

    /**
     * Gets a Spine asset by name.
     * @method
     * @param {string} name - The name of the Spine asset.
     * @returns {Object} - The Spine asset data.
     */
    getSpineAsset (name) {
        return this.spine[name];
    }

    /**
     * Sets the value of a configuration item.
     * @param {string} key - The key of the configuration item.
     * @param {*} value - The value to set.
     * @returns {void}
     */
    setConfig (key, value) {
        if (key && this.configs[key] !== value) {
            this.configs[key] = value;
            this.runtime.emitGandiConfigsUpdate(key, value);
            this.runtime.emitProjectChanged();
        }
    }

    /**
     * Gets the value of a specified configuration item.
     * @param {string} key - The key of the configuration item to retrieve the value.
     * @returns {*} The value of the specified configuration item, or undefined if it doesn't exist.
     */
    getConfig (key) {
        return this.configs[key];
    }

    /**
     * Adds a dynamic menu item.
     * @method
     * @param {string} menuName - The name of the dynamic menu.
     * @param {Object} menuItem - The dynamic menu item to add.
     */
    addDynamicMenuItem (menuName, menuItem) {
        if (!this.dynamicMenuItems[menuName]) {
            this.dynamicMenuItems[menuName] = [];
        }
        this.dynamicMenuItems[menuName].push(menuItem);
        this.runtime.emitGandiDynamicMenuItemsUpdate('add', menuName, menuItem);
        this.runtime.emitProjectChanged();
    }

    /**
     * Gets dynamic menu items by name.
     * @method
     * @param {string} menuName - The name of the dynamic menu.
     * @returns {Array} - Array of dynamic menu items.
     */
    getDynamicMenuItems (menuName) {
        return this.dynamicMenuItems[menuName] || [];
    }

    /**
     * Deletes dynamic menu items.
     * @method
     * @param {string} menuName - The name of the dynamic menu.
     * @param {string} id - The id of the dynamic menu item to delete.
     * @throws Will throw an error if the menu name is not provided.
     */
    deleteDynamicMenuItems (menuName, id) {
        if (menuName) {
            if (id) {
                const menus = this.dynamicMenuItems[menuName];
                if (menus) {
                    const idx = menus.findIndex(i => i.value === id);
                    menus.split(idx, 1);
                } else {
                    throw new Error(`Can not find dynamic menu: ${menuName}`);
                }
            } else {
                delete this.dynamicMenuItems[menuName];
            }
            this.runtime.emitGandiDynamicMenuItemsUpdate('delete', [menuName, id]);
        } else {
            throw new Error('The menu name must be provided.');
        }
        this.runtime.emitProjectChanged();
    }

    /**
     * Adds a wild extension.
     * @method
     * @param {Object} data - The data for the wild extension.
     */
    addWildExtension ({id, url}) {
        const eventType = this.wildExtensions[id] ? 'update' : 'add';
        this.wildExtensions[id] = {id, url};
        this.runtime.emitGandiWildExtensionsChanged([eventType, id, {id, url}]);
    }

    /**
        * Deletes a wild extension.
        * @method
        * @param {string} id - The id of the wild extension to delete.
        */
    deleteWildExtension (id) {
        if (this.wildExtensions[id]) {
            delete this.wildExtensions[id];
            this.runtime.emitGandiWildExtensionsChanged(['delete', id]);
        }
    }

    getExtensionAssets () {
                const AssetType = this.runtime.storage.AssetType;
        return this.assets.filter(item => {
            const type = item.asset?.assetType?.name || item.assetType?.name;
            return type === AssetType.Extension.name;
        });
    }

    isExtensionURLInGandiAssets (url) {
        const sb3Exts = this.getExtensionAssets();
        return sb3Exts.find(v => url.endsWith(v.md5));
    }

    addAsset (asset) {
        // check if the asset is already in the assets
        const isDuplicateAsset = b =>
            this.assets.find(obj => obj.name === b.name && obj.dataFormat === b.dataFormat && obj.md5 === b.md5);
        if (isDuplicateAsset(asset.assetId)) {
            log.warn(`addAsset - Duplicate asset found: ${asset.name}.${asset.dataFormat}. Skipping`);
            return false;
        }
        this.assets.push(asset);
        return true;
    }
}

module.exports = Gandi;
