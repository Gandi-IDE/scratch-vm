const test = require('tap').test;
const Patcher = require('../../src/extension-support/patcher');

test('Patcher - basic functionality', t => {
    t.type(Patcher, 'function');
    t.type(Patcher.UNDEFINED, 'symbol');
    t.end();
});

test('Patcher - patch and unpatch', t => {
    const obj = {
        add: (a, b) => a + b
    };
    
    const patcher = new Patcher('test-patcher');
    let beforeCalled = false;
    let afterCalled = false;
    
    patcher.patch(obj, 'add', {
        before: (a, b) => {
            beforeCalled = true;
            t.equal(a, 2);
            t.equal(b, 3);
        },
        after: (result, a, b) => {
            afterCalled = true;
            t.equal(result, 5);
            t.equal(a, 2);
            t.equal(b, 3);
            return result * 2;
        }
    });
    
    const result = obj.add(2, 3);
    t.equal(result, 10);
    t.equal(beforeCalled, true);
    t.equal(afterCalled, true);
    
    patcher.unpatch(obj, 'add');
    const resultAfterUnpatch = obj.add(2, 3);
    t.equal(resultAfterUnpatch, 5);
    
    t.end();
});

test('Patcher - before hook with early return', t => {
    const obj = {
        add: (a, b) => a + b
    };
    
    const patcher = new Patcher('test-patcher');
    patcher.patch(obj, 'add', {
        before: (a, b) => {
            if (a > 10) return 999;
        }
    });
    
    t.equal(obj.add(5, 3), 8);
    t.equal(obj.add(15, 3), 999);
    
    t.end();
});

test('Patcher - wrapper function', t => {
    const obj = {
        add: (a, b) => a + b
    };
    
    const patcher = new Patcher('test-patcher');
    patcher.patch(obj, 'add', (next, a, b) => {
        return next(a, b) * 10;
    });
    
    t.equal(obj.add(2, 3), 50);
    
    t.end();
});

test('Patcher - multiple patches on same method', t => {
    const obj = {
        add: (a, b) => a + b
    };
    
    const patcher1 = new Patcher('patcher1');
    const patcher2 = new Patcher('patcher2');
    
    patcher1.patch(obj, 'add', {
        after: (result) => result * 2
    });
    
    patcher2.patch(obj, 'add', {
        after: (result) => result + 10
    });
    
    t.equal(obj.add(2, 3), 20); // (2+3)*2 +10 = 20
    
    patcher1.unpatch(obj, 'add');
    t.equal(obj.add(2, 3), 15); // (2+3) +10 =15
    
    patcher2.unpatch(obj, 'add');
    t.equal(obj.add(2, 3), 5);
    
    t.end();
});

test('Patcher - replace function', t => {
    const obj = {
        add: (a, b) => a + b
    };
    
    const patcher = new Patcher('test-patcher');
    patcher.patch(obj, 'add', {
        replace: (a, b) => a * b
    });
    
    t.equal(obj.add(2, 3), 6);
    
    t.end();
});

test('Patcher - patchOnce option', t => {
    const obj = {
        add: (a, b) => a + b
    };
    
    const patcher = new Patcher('test-patcher');
    patcher.patch(obj, 'add', {
        before: () => {},
        patchOnce: true
    });
    
    // Second patch should fail
    const result = patcher.patch(obj, 'add', {
        before: () => {},
        patchOnce: true
    });
    
    t.equal(result, false);
    
    t.end();
});

test('Patcher - factory function', t => {
    const obj = {
        add: (a, b) => a + b
    };
    
    const patcher = new Patcher('test-factory');
    patcher.patch(obj, 'add', {
        factory: (next) => (a, b) => next(a, b) * 3
    });
    
    t.equal(obj.add(2, 3), 15); // (2+3)*3 =15
    
    t.end();
});

test('Patcher - patch overwrite', t => {
    const obj = {
        add: (a, b) => a + b
    };
    
    const patcher = new Patcher('test-overwrite');
    patcher.patch(obj, 'add', {
        after: (result) => result * 2
    });
    
    t.equal(obj.add(2, 3), 10);
    
    // Patch again to overwrite
    patcher.patch(obj, 'add', {
        after: (result) => result * 3
    });
    
    t.equal(obj.add(2, 3), 15); // (2+3)*3=15
    
    t.end();
});

test('Patcher - unpatchAll', t => {
    const obj = {
        add: (a, b) => a + b,
        multiply: (a, b) => a * b
    };
    
    const patcher = new Patcher('test-unpatchAll');
    patcher.patch(obj, 'add', {
        after: (result) => result * 2
    });
    patcher.patch(obj, 'multiply', {
        after: (result) => result + 10
    });
    
    t.equal(obj.add(2, 3), 10);
    t.equal(obj.multiply(2, 3), 16);
    
    const count = patcher.unpatchAll();
    t.equal(count, 2);
    
    t.equal(obj.add(2, 3), 5);
    t.equal(obj.multiply(2, 3), 6);
    
    t.end();
});

test('Patcher - listPatches', t => {
    const obj = {
        add: (a, b) => a + b
    };
    
    const patcher = new Patcher('test-listPatches');
    patcher.patch(obj, 'add', {
        after: (result) => result * 2
    });
    patcher.patch(obj, 'add', {
        name: 'after2',
        after: (result) => result * 2
    });
    
    const patches = patcher.listPatches();
    t.equal(patches.length, 2);
    t.equal(patches[0].methodName, 'add');
    t.equal(patches[1].name, 'after2');
    
    t.end();
});

// 补充测试：验证 Patcher.UNDEFINED 在 before 中提前返回 undefined
test('Patcher - UNDEFINED in before to return undefined', t => {
    const obj = {
        fn: () => 'original'
    };
    const patcher = new Patcher('before-undefined');
    patcher.patch(obj, 'fn', {
        before: () => Patcher.UNDEFINED
    });
    t.equal(obj.fn(), undefined);
    patcher.unpatchAll();
    t.end();
});

// 补充测试：验证 Patcher.UNDEFINED 在 after 中将返回值改为 undefined
test('Patcher - UNDEFINED in after to set return value to undefined', t => {
    const obj = {
        fn: () => 'original'
    };
    const patcher = new Patcher('after-undefined');
    patcher.patch(obj, 'fn', {
        after: () => Patcher.UNDEFINED
    });
    t.equal(obj.fn(), undefined);
    patcher.unpatchAll();
    t.end();
});

// 补充测试：patchOwner 默认 true，查找原型链拥有者
test('Patcher - patchOwner true finds prototype owner', t => {
    class Parent {
        method() { return 'parent'; }
    }
    class Child extends Parent {}
    const child = new Child();
    const patcher = new Patcher('prototype');
    patcher.patch(child, 'method', {
        after: res => res + ' patched'
    });
    t.equal(child.method(), 'parent patched');
    const patches = patcher.listPatches();
    t.equal(patches.length, 1);
    t.equal(patches[0].owner, Parent.prototype);
    t.equal(patches[0].methodName, 'method');
    patcher.unpatchAll();
    t.end();
});

// 补充测试：patchOwner false 直接 patch 在实例上
test('Patcher - patchOwner false patches instance directly', t => {
    class Parent {
        method() { return 'parent'; }
    }
    class Child extends Parent {}
    const child = new Child();
    const patcher = new Patcher('instance', { patchOwner: false });
    patcher.patch(child, 'method', {
        after: res => res + ' patched'
    });
    t.equal(child.method(), 'parent patched');
    const patches = patcher.listPatches();
    t.equal(patches.length, 1);
    t.equal(patches[0].owner, child);
    patcher.unpatchAll();
    t.end();
});

// 修正：before 钩子顺序与中断 —— 使用多个 patcher
test('Patcher - before hooks order and interruption (multiple patchers)', t => {
    const obj = {
        fn: () => 'original'
    };
    // 创建三个不同的 patcher
    const p1 = new Patcher('order-before-1');
    const p2 = new Patcher('order-before-2');
    const p3 = new Patcher('order-before-3');
    
    const log = [];
    
    p1.patch(obj, 'fn', {
        before: () => { log.push('before1'); }
    });
    p2.patch(obj, 'fn', {
        before: () => { log.push('before2'); return 'interrupted'; }
    });
    p3.patch(obj, 'fn', {
        before: () => { log.push('before3'); } // 不会执行
    });
    
    const result = obj.fn();
    t.equal(result, 'interrupted');
    t.same(log, ['before1', 'before2']); // p3 的 before 不会执行
    
    // 清理
    p1.unpatchAll();
    p2.unpatchAll();
    p3.unpatchAll();
    t.end();
});

// 修正：after 钩子顺序与值传递 —— 使用多个 patcher
test('Patcher - after hooks order and value modification (multiple patchers)', t => {
    const obj = {
        fn: () => 5
    };
    const p1 = new Patcher('order-after-1');
    const p2 = new Patcher('order-after-2');
    
    p1.patch(obj, 'fn', {
        after: res => { t.equal(res, 5); return res + 1; }
    });
    p2.patch(obj, 'fn', {
        after: res => { t.equal(res, 6); return res * 2; }
    });
    
    const result = obj.fn();
    t.equal(result, 12); // 5+1=6, 6*2=12
    
    p1.unpatchAll();
    p2.unpatchAll();
    t.end();
});

// 修正：混合补丁类型 —— 使用多个 patcher 模拟叠加
test('Patcher - mix of before, after, wrapper, factory, replace (multiple patchers)', t => {
    const obj = {
        compute: x => x
    };
    // 每个补丁使用独立 patcher
    const pBefore = new Patcher('mix-before');
    const pWrapper = new Patcher('mix-wrapper');
    const pFactory = new Patcher('mix-factory');
    const pAfter = new Patcher('mix-after');
    
    pBefore.patch(obj, 'compute', {
        before: x => { t.equal(x, 5); } // 无返回值，不中断
    });
    pWrapper.patch(obj, 'compute', function(next, x) {
        return next(x) * 2;
    });
    pFactory.patch(obj, 'compute', {
        factory: next => x => next(x) + 3
    });
    pAfter.patch(obj, 'compute', {
        after: res => res - 1
    });
    
    // 组合顺序（按 patch 顺序）：
    // before (无影响) -> wrapper (*2) -> factory (+3) -> after (-1)
    // 原始结果：5
    // wrapper 后：10
    // factory 后：13
    // after 后：12
    const result = obj.compute(5);
    t.equal(result, 12);
    
    pBefore.unpatchAll();
    pWrapper.unpatchAll();
    pFactory.unpatchAll();
    pAfter.unpatchAll();
    t.end();
});

// 修正：多个 before，第一个返回非 undefined 即停止
test('Patcher - multiple before hooks, first returns non-undefined stops (multiple patchers)', t => {
    const obj = {
        fn: () => 'original'
    };
    const p = new Patcher('multi-before-1');
    const p2 = new Patcher('multi-before-2');
    const p3 = new Patcher('multi-before-3');
    
    const log = [];
    p.patch(obj, 'fn', {
        name: 'before1',
        before: () => { log.push('1'); }
    });
    p2.patch(obj, 'fn', {
        name: 'before2',
        before: () => { log.push('2'); return 'stopped'; }
    });
    p3.patch(obj, 'fn', {
        name: 'before3',
        before: () => { log.push('3'); } // 不会执行
    });
    
    const result = obj.fn();
    t.equal(result, 'stopped');
    t.same(log, ['1', '2']);
    
    p.unpatchAll();
    t.end();
});

// 修正：多个 after 依次修改返回值
test('Patcher - multiple after hooks modify value sequentially (multiple patchers)', t => {
    const obj = {
        fn: () => 1
    };
    const p = new Patcher('multi-after-1');
    
    p.patch(obj, 'fn', {
        name: 'after1',
        after: res => res + 1
    });
    p.patch(obj, 'fn', {
        name: 'after2',
        after: res => res * 2
    });
    p.patch(obj, 'fn', {
        name: 'after3',
        after: res => res - 3
    });
    // (1+1)*2-3 = 1
    const result = obj.fn();
    t.equal(result, 1);
    
    p.unpatchAll();
    t.end();
});

// 补充测试：对不存在的方法 patch 返回 false
test('Patcher - patch non-existent method returns false', t => {
    const obj = {};
    const patcher = new Patcher('nonexistent');
    const result = patcher.patch(obj, 'missing', { before: () => {} });
    t.equal(result, false);
    t.end();
});

// 补充测试：getCustomInfo 返回同一 id 共享的对象
test('Patcher - getCustomInfo returns shared object for same id', t => {
    const patcher1 = new Patcher('custom');
    const patcher2 = new Patcher('custom');
    patcher1.getCustomInfo().foo = 'bar';
    t.equal(patcher2.getCustomInfo().foo, 'bar');
    patcher2.getCustomInfo().baz = 123;
    t.equal(patcher1.getCustomInfo().baz, 123);
    patcher1.unpatchAll(); // 清理
    t.end();
});

// 补充测试：空 spec 对象不应抛出异常
test('Patcher - empty spec should not throw', t => {
    const obj = { method: () => {} };
    const patcher = new Patcher('empty');
    t.doesNotThrow(() => {
        patcher.patch(obj, 'method', {});
    });
    t.equal(obj.method(), undefined); // 无变化
    patcher.unpatchAll();
    t.end();
});

// 补充测试：相同 id 多次 patch 会覆盖旧补丁
test('Patcher - multiple patch with same id overwrites', t => {
    const obj = { calc: () => 1 };
    const patcher = new Patcher('overwrite');
    patcher.patch(obj, 'calc', { replace: () => 2 });
    t.equal(obj.calc(), 2);
    patcher.patch(obj, 'calc', { replace: () => 3 });
    t.equal(obj.calc(), 3);
    const patches = patcher.listPatches();
    t.equal(patches.length, 1); // 仍为一个补丁
    patcher.unpatchAll();
    t.end();
});

// 补充测试：listPatches 对原型补丁返回正确的 owner
test('Patcher - listPatches returns correct owner for prototype patch', t => {
    class A { method() {} }
    class B extends A {}
    const b = new B();
    const patcher = new Patcher('list-owner');
    patcher.patch(b, 'method', { before: () => {} });
    const patches = patcher.listPatches();
    t.equal(patches.length, 1);
    t.equal(patches[0].owner, A.prototype);
    t.equal(patches[0].methodName, 'method');
    patcher.unpatchAll();
    t.end();
});

// 补充测试：after 钩子可以访问原函数参数
test('Patcher - after hook can access original arguments', t => {
    const obj = {
        sum: (a, b) => a + b
    };
    const patcher = new Patcher('after-args');
    patcher.patch(obj, 'sum', {
        after: (result, a, b) => {
            t.equal(result, 5);
            t.equal(a, 2);
            t.equal(b, 3);
            return result * (a + b);
        }
    });
    const patches = patcher.listPatches(obj, 'sum');
    t.equal(patches.length, 1);
    t.equal(patches[0].name, 'default');
    const result = obj.sum(2, 3);
    t.equal(result, 25); // 5 * 5
    patcher.unpatchAll();
    t.end();
});

// 补充测试：多 patch 支持不同名称
test('Patcher - multiple patches with different names', t => {
    const obj = {
        add: (a, b) => a + b
    };
    const patcher = new Patcher('multi-names');
    let count1 = 0;
    let count2 = 0;
    patcher.patch(obj, 'add', {
        name: 'feature1',
        before: () => {count1++}
    });
    const patches = patcher.listPatches(obj, 'add');
    t.equal(patches.length, 1);
    t.equal(patches[0].name, 'feature1');
    patcher.patch(obj, 'add', {
        name: 'feature2',
        before: () => {count2++}
    });
    const result = obj.add(1, 2);
    t.equal(result, 3);
    t.equal(count1, 1);
    t.equal(count2, 1);
    // 同名覆盖
    patcher.patch(obj, 'add', {
        name: 'feature1',
        before: () => {count1 += 2}
    });
    const result2 = obj.add(1, 2);
    t.equal(result2, 3);
    t.equal(count1, 3); // 1 + 2
    t.equal(count2, 2); // 1 + 1
    // unpatch 特定名称
    patcher.unpatch(obj, 'add', 'feature2');
    const result3 = obj.add(1, 2);
    t.equal(result3, 3);
    t.equal(count1, 5); // 3 + 2
    t.equal(count2, 2);
    patcher.unpatchAll();
    t.end();
});

// 补充测试：pause/resume 功能
test('Patcher - pause and resume patch', t => {
    const obj = {
        multiply: (a, b) => a * b
    };
    const patcher = new Patcher('pause-resume');
    let called = false;
    patcher.patch(obj, 'multiply', {
        before: () => { called = true; }
    });
    let result = obj.multiply(2, 3);
    t.equal(result, 6);
    t.equal(called, true);
    called = false;
    // pause
    patcher.pause(obj, 'multiply');
    result = obj.multiply(2, 3);
    t.equal(result, 6);
    t.equal(called, false);
    // resume
    patcher.resume(obj, 'multiply');
    result = obj.multiply(2, 3);
    t.equal(result, 6);
    t.equal(called, true);
    patcher.unpatchAll();
    t.end();
});

// 补充测试：pauseAll/resumeAll 功能
test('Patcher - pauseAll and resumeAll patches', t => {
    const obj1 = { add: (a, b) => a + b };
    const obj2 = { multiply: (a, b) => a * b };
    const patcher = new Patcher('pauseall-resumeall');
    let called1 = false;
    let called2 = false;
    patcher.patch(obj1, 'add', {
        before: () => { called1 = true; }
    });
    patcher.patch(obj2, 'multiply', {
        before: () => { called2 = true; }
    });
    // pause all
    patcher.pauseAll();
    let result1 = obj1.add(1, 2);
    let result2 = obj2.multiply(2, 3);
    t.equal(result1, 3);
    t.equal(result2, 6);
    t.equal(called1, false);
    t.equal(called2, false);
    // resume all
    patcher.resumeAll();
    called1 = false;
    called2 = false;
    result1 = obj1.add(1, 2);
    result2 = obj2.multiply(2, 3);
    t.equal(result1, 3);
    t.equal(result2, 6);
    t.equal(called1, true);
    t.equal(called2, true);
    patcher.unpatchAll();
    t.end();
});

// ==================== 高级用法测试 ====================

// 测试：多次 patch - 默认覆盖行为
test('Patcher - multiple patches default overwrite', t => {
    const obj = {
        method: () => 'original'
    };
    const patcher = new Patcher('multi-patch-overwrite');
    
    // 第一次 patch
    patcher.patch(obj, 'method', {
        after: () => 'first'
    });
    t.equal(obj.method(), 'first');
    
    // 第二次 patch（同名，默认覆盖）
    patcher.patch(obj, 'method', {
        after: () => 'second'
    });
    t.equal(obj.method(), 'second');
    
    const patches = patcher.listPatches(obj, 'method');
    t.equal(patches.length, 1); // 只有一个 patch
    
    patcher.unpatchAll();
    t.end();
});

// 测试：多次 patch - 使用不同 name 保留多个 patch
test('Patcher - multiple patches with different names', t => {
    const obj = {
        method: () => 'original'
    };
    const patcher = new Patcher('multi-patch-names');
    
    // 使用不同 name 的多个 patch
    patcher.patch(obj, 'method', {
        name: 'feature1',
        after: (res) => res + '-feature1'
    });
    patcher.patch(obj, 'method', {
        name: 'feature2',
        after: (res) => res + '-feature2'
    });
    
    const result = obj.method();
    t.equal(result, 'original-feature1-feature2');
    
    const patches = patcher.listPatches(obj, 'method');
    t.equal(patches.length, 2);
    t.equal(patches[0].name, 'feature1');
    t.equal(patches[1].name, 'feature2');
    
    // 同名 patch 覆盖
    patcher.patch(obj, 'method', {
        name: 'feature2',
        after: (res) => res + '-overwritten'
    });
    
    const result2 = obj.method();
    t.equal(result2, 'original-feature1-overwritten');
    
    const patches2 = patcher.listPatches(obj, 'method');
    t.equal(patches2.length, 2); // 仍然是 2 个
    
    patcher.unpatchAll();
    t.end();
});

// 测试：unpatch 指定 name
test('Patcher - unpatch with specific name', t => {
    const obj = {
        method: () => 10
    };
    const patcher = new Patcher('unpatch-name');
    
    patcher.patch(obj, 'method', {
        name: 'add1',
        after: (res) => res + 1
    });
    patcher.patch(obj, 'method', {
        name: 'multiply2',
        after: (res) => res * 2
    });
    
    t.equal(obj.method(), 22); // (10+1)*2 = 22
    
    // 移除指定 name 的 patch
    patcher.unpatch(obj, 'method', 'multiply2');
    
    t.equal(obj.method(), 11); // 10+1 = 11
    
    const patches = patcher.listPatches(obj, 'method');
    t.equal(patches.length, 1);
    t.equal(patches[0].name, 'add1');
    
    patcher.unpatchAll();
    t.end();
});

// 测试：patch 顺序 - ORDER_EARLY, ORDER_NORMAL, ORDER_LATE
test('Patcher - patch order with ORDER constants', t => {
    const obj = {
        method: () => { log.push('orig'); }
    };
    
    const patcher1 = new Patcher('order-late');
    const patcher2 = new Patcher('order-early');
    const patcher3 = new Patcher('order-normal');
    
    const log = [];
    
    patcher1.patch(obj, 'method', {
        order: Patcher.ORDER_LATE,
        before: () => { log.push('late-before'); },
        wrapper: (orig, ...args) => {
            log.push('late-wrap');
            return orig.apply(this, args);
        },
        after: () => { log.push('late-after'); }
    });
    
    patcher2.patch(obj, 'method', {
        order: Patcher.ORDER_EARLY,
        before: () => { log.push('early-before'); },
        wrapper: (orig, ...args) => {
            log.push('early-wrap');
            return orig.apply(this, args);
        },
        after: () => { log.push('early-after'); }
    });
    
    patcher3.patch(obj, 'method', {
        order: Patcher.ORDER_NORMAL,
        before: () => { log.push('normal-before'); },
        wrapper: (orig, ...args) => {
            log.push('normal-wrap');
            return orig.apply(this, args);
        },
        after: () => { log.push('normal-after'); }
    });
    
    obj.method();
    
    // before 执行顺序：EARLY -> NORMAL -> LATE
    t.equal(log[0], 'early-before');
    t.equal(log[1], 'normal-before');
    t.equal(log[2], 'late-before');

    t.equal(log[3], 'late-wrap');
    t.equal(log[4], 'normal-wrap');
    t.equal(log[5], 'early-wrap');
    t.equal(log[6], 'orig');
    
    // after 执行顺序：EARLY -> NORMAL -> LATE
    t.equal(log[7], 'early-after');
    t.equal(log[8], 'normal-after');
    t.equal(log[9], 'late-after');
    
    t.equal(log.length, 10);
    
    patcher1.unpatchAll();
    patcher2.unpatchAll();
    patcher3.unpatchAll();
    t.end();
});

// 测试：patch 顺序 - 自定义 order 值
test('Patcher - patch order with custom order values', t => {
    const obj = {
        compute: () => 0
    };
    
    const p1 = new Patcher('order-10');
    const p2 = new Patcher('order-5');
    const p3 = new Patcher('order-1');
    
    const log = [];
    
    // 以不同顺序 patch，验证 order 值决定执行顺序
    p3.patch(obj, 'compute', {
        order: 1,
        before: () => { log.push(1); },
        after: (res) => res + 1
    });
    
    p1.patch(obj, 'compute', {
        order: 10,
        before: () => { log.push(10); },
        after: (res) => res + 10
    });
    
    p2.patch(obj, 'compute', {
        order: 5,
        before: () => { log.push(5); },
        after: (res) => res + 5
    });
    
    const result = obj.compute();
    
    // before 执行顺序：1 -> 5 -> 10
    t.same(log, [1, 5, 10]);
    
    // after 计算：0 + 1 + 5 + 10 = 16
    t.equal(result, 16);
    
    p1.unpatchAll();
    p2.unpatchAll();
    p3.unpatchAll();
    t.end();
});

// 测试：patch 顺序 - 混合使用不同 patch 类型
test('Patcher - patch order with mixed patch types', t => {
    const obj = {
        value: () => 100
    };
    
    const pEarly = new Patcher('early');
    const pLate = new Patcher('late');
    
    const log = [];
    
    // LATE: after 修改返回值
    pLate.patch(obj, 'value', {
        order: Patcher.ORDER_LATE,
        after: (res) => {
            log.push('late-after');
            return res * 2;
        }
    });
    
    // EARLY: before 记录日志
    pEarly.patch(obj, 'value', {
        order: Patcher.ORDER_EARLY,
        before: () => {
            log.push('early-before');
        }
    });
    
    const result = obj.value();
    
    // before 先执行（EARLY）
    t.equal(log[0], 'early-before');
    // after 后执行（LATE）
    t.equal(log[1], 'late-after');
    
    // 返回值被 LATE 的 after 修改
    t.equal(result, 200); // 100 * 2
    
    pEarly.unpatchAll();
    pLate.unpatchAll();
    t.end();
});

// 测试：order 影响 before 钩子的中断行为
test('Patcher - order affects before hook interruption', t => {
    const obj = {
        method: () => 'should-not-reach'
    };
    
    const pEarly = new Patcher('early-interrupt');
    const pLate = new Patcher('late-no-interrupt');
    
    const log = [];
    
    // LATE 的 before 返回中断值，但由于 EARLY 先执行，如果 EARLY 中断则 LATE 不会执行
    pLate.patch(obj, 'method', {
        order: Patcher.ORDER_LATE,
        before: () => {
            log.push('late');
            return 'late-interrupted';
        }
    });
    
    pEarly.patch(obj, 'method', {
        order: Patcher.ORDER_EARLY,
        before: () => {
            log.push('early');
            return 'early-interrupted';
        }
    });
    
    const result = obj.method();
    
    // EARLY 先执行并中断，LATE 不会执行
    t.same(log, ['early']);
    t.equal(result, 'early-interrupted');
    
    pEarly.unpatchAll();
    pLate.unpatchAll();
    t.end();
});

// 测试：文档示例 - 多次 patch 覆盖
test('Patcher - doc example: multiple patches overwrite', t => {
    const obj = {
        _step: () => {}
    };
    
    const patcher = new Patcher('doc-example-1');
    const log = [];
    
    patcher.patch(obj, '_step', {
        before: function () {
            log.push('1');
        }
    });
    
    // 重复 patch 时，会覆盖之前的 patch
    patcher.patch(obj, '_step', {
        before: function () {
            log.push('2');
        }
    });
    
    obj._step();
    
    t.same(log, ['2']); // 只有第二个执行
    
    patcher.unpatchAll();
    t.end();
});

// 测试：文档示例 - 使用 name 保留多个 patch
test('Patcher - doc example: multiple patches with names', t => {
    const obj = {
        _step: () => {}
    };
    
    const patcher = new Patcher('doc-example-2');
    const log = [];
    
    patcher.patch(obj, '_step', {
        name: '功能 1',
        before: function () {
            log.push('fun1');
        }
    });
    
    patcher.patch(obj, '_step', {
        name: '功能 2',
        before: function () {
            log.push('fun2');
        }
    });
    
    // 同名则覆盖之前的 patch
    patcher.patch(obj, '_step', {
        name: '功能 2',
        before: function () {
            log.push('覆盖！');
        }
    });
    
    obj._step();
    
    t.same(log, ['fun1', '覆盖！']);
    
    // 移除指定 name 的 patch
    patcher.unpatch(obj, '_step', '功能 2');
    
    log.length = 0;
    obj._step();
    t.same(log, ['fun1']);
    
    patcher.unpatchAll();
    t.end();
});

// 测试：文档示例 - patch 顺序
test('Patcher - doc example: patch order', t => {
    const obj = {
        test: function () {
            return 'original';
        }
    };
    
    const patcher1 = new Patcher('ext1');
    const patcher2 = new Patcher('ext2');
    const patcher3 = new Patcher('ext3');
    
    const log = [];
    
    patcher1.patch(obj, 'test', {
        order: Patcher.ORDER_LATE,
        before: function () {
            log.push('ext1');
        }
    });
    
    patcher2.patch(obj, 'test', {
        order: Patcher.ORDER_EARLY,
        before: function () {
            log.push('ext2');
        }
    });
    
    patcher3.patch(obj, 'test', {
        order: Patcher.ORDER_NORMAL,
        before: function () {
            log.push('ext3');
        }
    });
    
    obj.test();
    
    // 输出顺序：ext2, ext3, ext1
    t.same(log, ['ext2', 'ext3', 'ext1']);
    
    patcher1.unpatchAll();
    patcher2.unpatchAll();
    patcher3.unpatchAll();
    t.end();
});


