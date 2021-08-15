const tap = require('tap');
const ExtendedJSON = require('../../src/util/tw-extended-json');

const test = tap.test;

const objects = [
    {
        'a': 3,
        'b': [
            {
                '': [
                    {
                        e: false,
                        d: true
                    },
                    [
                        [
                            '3'
                        ]
                    ]
                ]
            }
        ],
        'e#$%(&$\b# 4': 'Hello !',
        'c': '1\n2\b3'
    },
    {
        framerate: 40
    },
    true,
    false,
    0,
    1,
    2,
    3,
    'e'
];

const stringObjects = [
    '{"test":4.3e-3}'
];

test('parse objects', t => {
    for (const object of objects) {
        const str = JSON.stringify(object);
        t.same(ExtendedJSON.parse(str), JSON.parse(str));
    }
    for (const str of stringObjects) {
        t.same(ExtendedJSON.parse(str), JSON.parse(str));
    }
    t.end();
});

test('parse extended', t => {
    const str = '{"a":Infinity,"b":-Infinity,"c":NaN}';
    t.same(ExtendedJSON.parse(str), {
        a: Infinity,
        b: -Infinity,
        c: NaN
    });
    t.end();
});

test('stringify objects', t => {
    for (const object of objects) {
        t.same(ExtendedJSON.stringify(object), JSON.stringify(object));
    }
    t.end();
});

test('stringify extended', t => {
    const object = {
        a: Infinity,
        b: -Infinity
    };
    t.equal(ExtendedJSON.stringify(object), `{"a":Infinity,"b":-Infinity}`);
    t.end();
});
