/**
 * patcher.js
 * by Arkos & GPT5
 * doc: see ./patcher-doc.md
 */

const hasOwn = Object.prototype.hasOwnProperty;
/**
 * @typedef SinglePatch
 * @property {string} patcherId - patcher id
 * @property {string} name - patch name
 * @property {number} order - patch order
 * @property {(orig)=>Function} [factory]
 * @property {(orig, ...args)=>Function} [wrapper]
 * @property {Function} [before]
 * @property {Function} [after]
 * @property {Function} [replace]
 * @property {boolean} [paused=false] 是否暂停应用
 */
/**
 * @typedef FunctionRecord
 * @property {Array<SinglePatch>} patches 应用在该函数的所有 patch 信息
 * 
 * @property {Function} patched patched function
 * @property {Array<Function>} befores before 钩子函数列表
 * @property {Function} wrapped 中间函数
 * @property {Array<Function>} afters after 钩子函数列表
 * @property {Function} original 原始函数
 * @property {object} customInfo 自定义信息
 */

const namespace = '__Arkos_Patcher';

/**
 * patchedObject→ <methodName, pathcedInfo>
 * @type {WeakMap<object, Map<string, FunctionRecord>>}
 */
const patchedObjectMap = new WeakMap();
/**
 * patcherId → PatcherInfo
 * @type {Map<string, {ownerMap: Map<object, Set<string>>, customInfo: object}>}
 */
const patcherInfoMap = new Map();

function firstLetterToLower(str) {
  if (typeof str !== 'string' || str.length === 0) {
    return '';
  }
  return str[0].toLowerCase() + str.slice(1);
}

function getObjectName(object) {
  if (!object) return String(object);
  const className = object.constructor?.name;
  if (!className || className === 'Object') return 'unnamed object';
  return firstLetterToLower(className);
}

class Patcher {
  /**
   * Used to explicitly return undefined in before/after hooks:
   * - Before hook returns Patcher.UNDEFINED to skip original function execution (returning regular undefined means no return value, continuing original function execution)
   * - After hook returns Patcher.UNDEFINED to explicitly set return value to undefined
   * @public
   * @constant
   * @type {Symbol}
   */
  static UNDEFINED = Symbol.for(`${namespace}_UNDEFINED`);

  static ORDER_EARLY = -1;
  static ORDER_NORMAL = 0;
  static ORDER_LATE = 1;
  
  static get DEFAULT_PATCH_NAME() {
    return 'default';
  }

  /**
   * new Patcher(id, options)
   * options:
   *  @param {string} id - patcher id
   *  @param {Options} options
   *  @param {boolean} [options.patchOwner=true] (Default: true) Whether to patch on the prototype that owns the method
   */
  constructor(id, options = {}) {
    if (!id) throw new Error('Patcher requires an id');
    this.id = String(id);
    this.options = {
      patchOwner: options.patchOwner !== undefined ? !!options.patchOwner : true, // Default: true
    };
    let patcherInfo = patcherInfoMap.get(id);
    if (!patcherInfo) {
      patcherInfo = {
        ownerMap: new Map(),
        customInfo: {},
      };
      patcherInfoMap.set(id, patcherInfo);
    }
    this.patcherInfo = patcherInfo;
  }

  /**
   * Find the first object that owns the property along the prototype chain
   * @private
   * @param {object} target Initial object
   * @param {string} methodName Method name
   * @returns {object|null} The object that owns the property, or null if not found
   */
  static _findOwner(target, methodName) {
    if (!target) return null;
    let obj = target;
    while (obj) {
      if (hasOwn.call(obj, methodName)) return obj;
      obj = Object.getPrototypeOf(obj);
    }
    return null;
  }

  /**
   * Create a patched function
   * @private
   * @param {FunctionRecord} rec Patch information
   * @returns {Function} Patched function
   */
  static _createPatchedFunction(rec) {
    const { befores, afters } = rec;
    return function patched(...args) {
      for (let i = 0; i < befores.length; i++) {
        const res = befores[i].apply(this, args);
        // Early return if there's a result
        // Note: Returning undefined directly means no return value. If you want to explicitly return undefined, use Patcher.UNDEFINED
        if (res !== undefined) return res === Patcher.UNDEFINED ? undefined : res;
      }
      let res = rec.wrapped.apply(this, args);
      for (let i = 0; i < afters.length; i++) {
        const r = afters[i].call(this, res, ...args);
        if (r !== undefined) res = r === Patcher.UNDEFINED ? undefined : r;
      }
      return res;
    };
  }

  /**
   * Get patch information from owner
   * @private
   * @param {object} owner
   * @param {string} methodName
   * @param {boolean} createIfMissing
   * @returns {FunctionRecord|null} Patch information
   */
  static _getRecord(owner, methodName, createIfMissing = false) {
    if (!owner || !owner[methodName]) {
      console.warn(`Patcher: failed to find method '${methodName}' in owner`);
      return null;
    }
    let map = patchedObjectMap.get(owner);
    if (!map) {
      if (!createIfMissing) return null;
      map = new Map();
      patchedObjectMap.set(owner, map);
    }
    let rec = map.get(methodName);
    if (!rec && createIfMissing) {
      const original = owner[methodName];
      rec = {
        // Original function when first patched
        original,
        befores: [],
        afters: [],
        patches: [],
        wrapped: original,
        customInfo: {},
      };
      const patched = Patcher._createPatchedFunction(rec);
      try {
        owner[methodName] = patched;
      } catch (e) {
        console.warn(`Patcher: failed to install patched method ${methodName}`, e);
      }
      map.set(methodName, rec);
    }
    return rec;
  }

  /**
   * Recompose and install the final function (updates before/after hooks and wrapped function)
   * @private
   * @param {FunctionRecord} rec
   */
  static _recomposeAndInstall(rec) {
    // Sort patches by order
    rec.patches.sort((a, b) => a.order - b.order);
    // Apply before/after hooks
    const befores = rec.patches.filter((p) => !p.paused && typeof p.before === 'function').map((p) => p.before);
    const afters = rec.patches.filter((p) => !p.paused && typeof p.after === 'function').map((p) => p.after);
    // Clear original hooks
    rec.afters.length = 0;
    rec.befores.length = 0;
    rec.afters.push(...afters);
    rec.befores.push(...befores);
    // Check for replace function
    const replace = rec.patches.filter((p) => typeof p.replace === 'function' && !p.paused);
    let fn = rec.original;
    if (replace.length > 0) {
      fn = replace[0].replace;
      if (replace.length > 1) {
        console.warn(`Patcher: multiple replace patches found, only the first one will be applied`);
      }
    }
    // Apply wrappers
    const useWrapper = (wrapper, orig) => {
      return function (...args) {
        return wrapper.call(this, orig, ...args);
      };
    };
    rec.patches.forEach(({ wrapper, factory, paused }) => {
      if (paused) return;
      if (typeof factory === 'function') {
        fn = factory(fn);
      } else if (typeof wrapper === 'function') {
        fn = useWrapper(wrapper, fn);
      }
    });
    rec.wrapped = fn;
  }

  /**
   * Record that current patcher has patched methodName on owner
   * @private
   * @param {object} owner
   * @param {string} methodName
   */
  _recordPatch(owner, methodName) {
    const { ownerMap } = this.patcherInfo;
    let methodSet = ownerMap.get(owner);
    if (!methodSet) {
      methodSet = new Set();
      ownerMap.set(owner, methodSet);
    }
    methodSet.add(methodName);
  }

  /**
   * Store additional custom information for current patcher
   * @returns {object} Custom information object
   */
  getCustomInfo() {
    return this.patcherInfo.customInfo;
  }

  /**
   * Patch object method
   * @param {object} target Target object (if Patcher's `patchOwner` is true, automatically finds instance prototype)
   * @param {string} methodName
   * @param {object} spec Patch information
   * @param {string} [spec.name] (Optional) Patch name. By default, a patcher can only patch the same method once.
   * @param {number} [spec.order] (default: 0) Patch order. Lower order patches are applied first.
   * To patch multiple times, you must specify different names (otherwise it will overwrite previous patch)
   * @param {Function} [spec.before]
   * Before hook function
   * - Parameters: Original function parameters
   * - Return value:
   *   - No return value/returns undefined: Continue executing original function
   *   - Has return value (non-undefined): Use as return value instead of executing original function
   *   - To skip original function execution with no return value, return `Patcher.UNDEFINED`
   * @param {Function} [spec.after]
   * After hook function
   * - Parameters: (Original function return value, ...original function parameters)
   * - Return value:
   *   - No return value/returns undefined: No additional processing
   *   - Has return value (non-undefined): Modify original function's return value and pass to subsequent after hooks
   *   - To explicitly set return value to undefined, return `Patcher.UNDEFINED`
   * @param {(orig, ...args)=>Function} [spec.wrapper] 
   * Wrapper function for wrapping new function
   * - Parameters: (Original function, ...original function parameters)
   * @param {(orig)=>Function} [spec.factory] Factory function for creating new function
   * @param {Function} [spec.replace] Replacement function to directly replace original function
   * @param {boolean} [spec.patchOnce] Whether to keep first patch when patching multiple times (default: overwrite)
   * @returns {boolean} Whether patch was successful
   */
  patch(target, methodName, spec) {
    const owner = this.options.patchOwner ? Patcher._findOwner(target, methodName) || target : target;
    const ownerName = getObjectName(owner);
    const rec = Patcher._getRecord(owner, methodName, true);
    if (!rec) return false;

    /** @type {SinglePatch} */
    let patch = {
        name: spec?.name ?? Patcher.DEFAULT_PATCH_NAME,
        patcherId: this.id,
        paused: false,
        order: spec?.order ?? Patcher.ORDER_NORMAL,
    };
    if (typeof spec === 'function') {
      // If spec is a function, treat it as a wrapper by default
      patch.wrapper = spec;
    } else if (spec) {
      patch = {
        ...patch,
        ...spec,
      };
    }

    const existingIndex = rec.patches.findIndex((p) => p.name === patch.name && p.patcherId === this.id);
    if (existingIndex >= 0) {
      // Already patched
      // If new patch has patchOnce: true, do not overwrite
      if (spec && spec.patchOnce) {
        console.warn(`Patcher '${this.id}' has already patched '${methodName}'(patch name '${patch.name}') on the owner '${ownerName}'.`);
        return false;
      }
      // Overwrite patch with the same name
      rec.patches[existingIndex] = patch;
      console.warn(`Patcher '${this.id}' has already patched '${methodName}'(patch name '${patch.name}') on the owner '${ownerName}'. The new patch will overwrite the old one.`);
    } else {
      rec.patches.push(patch);
    }
    this._recordPatch(owner, methodName);
    Patcher._recomposeAndInstall(rec);

    return true;
  }

  /**
   * Unpatch object method
   * @param {object} target
   * @param {string} methodName
   * @param {string} [name] (Optional) Patch name
   * @returns {boolean} Whether unpatch was successful
   */
  unpatch(target, methodName, name = Patcher.DEFAULT_PATCH_NAME) {
    if (!target || typeof methodName !== 'string') return false;
    const owner = this.options.patchOwner ? Patcher._findOwner(target, methodName) || target : target;
    const rec = Patcher._getRecord(owner, methodName, false);
    if (!rec) return false;
    const idx = rec.patches.findIndex((p) => p.patcherId === this.id && p.name === name);
    if (idx === -1) return false;
    rec.patches.splice(idx, 1);
    Patcher._recomposeAndInstall(rec);

    // Update ownerMap
    const { ownerMap } = this.patcherInfo;
    if (ownerMap) {
      const methodSet = ownerMap.get(owner);
      const noOtherPatch = rec.patches.every((p) => p.patcherId !== this.id);
      if (methodSet && noOtherPatch) {
        methodSet.delete(methodName);
        if (methodSet.size === 0) ownerMap.delete(owner);
      }
    }

    return true;
  }

  /**
   * Uninstall all patches for current patcher
   * @returns {number} Number of successfully uninstalled patches
   */
  unpatchAll() {
    const { ownerMap } = this.patcherInfo;
    if (!ownerMap) return 0;
    let count = 0;
    this.listPatches().forEach(({ owner, methodName, name }) => {
      if (this.unpatch(owner, methodName, name)) {
        count++;
      }
    });
    ownerMap.clear();
    return count;
  }

  /**
   * Get list of methods patched by current patcher on various owners
   * @returns {Array<{owner: object, methodName: string, name: string}>} Patch information list
   */
  listPatches() {
    const { ownerMap } = this.patcherInfo;
    if (!ownerMap) return [];
    const out = [];
    ownerMap.forEach((methodSet, owner) => {
      methodSet.forEach((methodName) => {
        const rec = Patcher._getRecord(owner, methodName, false);
        if (!rec) return;
        rec.patches.forEach((p) => {
          if (p.patcherId === this.id) {
            out.push({ owner, methodName, name: p.name });
          }
        });
      });
    });
    return out;
  }

  /**
   * Pause/resume a patch
   * @private
   * @param {object} target
   * @param {string} methodName
   * @param {boolean} paused Whether to pause
   * @param {string} [name] (Optional) Patch name
   * @returns {boolean} Whether pause/resume was successful
   */
  _setPause(target, methodName, paused, name = Patcher.DEFAULT_PATCH_NAME) {
    if (!target || typeof methodName !== 'string') return false;
    const owner = this.options.patchOwner ? Patcher._findOwner(target, methodName) || target : target;
    const rec = Patcher._getRecord(owner, methodName, false);
    if (!rec) return false;
    const patch = rec.patches.find((p) => p.patcherId === this.id && p.name === name);
    if (!patch) return false;
    patch.paused = paused;
    Patcher._recomposeAndInstall(rec);
    return true;
  }

  /**
   * Pause a patch
   * @param {object} target
   * @param {string} methodName
   * @param {string} [name] (Optional) Patch name
   * @returns {boolean} Whether pause was successful
   */
  pause(target, methodName, name = Patcher.DEFAULT_PATCH_NAME) {
    return this._setPause(target, methodName, true, name);
  }

  /**
   * Resume a patch
   * @param {object} target
   * @param {string} methodName
   * @param {string} [name] (Optional) Patch name
   * @returns {boolean} Whether resume was successful
   */
  resume(target, methodName, name = Patcher.DEFAULT_PATCH_NAME) {
    return this._setPause(target, methodName, false, name);
  }

  /**
   * Pause/resume all patches for current patcher
   * @private
   * @param {boolean} paused Whether to pause
   * @returns {number} Number of successfully paused/resumed patches
   */
  _setPauseAll(paused) {
    const { ownerMap } = this.patcherInfo;
    if (!ownerMap) return 0;
    let count = 0;
    this.listPatches().forEach(({ owner, methodName, name }) => {
      if (this._setPause(owner, methodName, paused, name)) {
        count++;
      }
    });
    return count;
  }

  /**
   * Pause all patches for current patcher
   * @returns {number} Number of successfully paused patches
   */
  pauseAll() {
    return this._setPauseAll(true);
  }

  /**
   * Resume all patches for current patcher
   * @returns {number} Number of successfully resumed patches
   */
  resumeAll() {
    return this._setPauseAll(false);
  }
}

module.exports = Patcher;
