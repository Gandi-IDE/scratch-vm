const tap = require('tap');
const ExtendedJSON = require('../../src/tw-extended-json');

const test = tap.test;

test('parse complex', t => {
    const str = JSON.stringify({
        a: 3,
        b: [
            {
                c: [
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
        c: '1\n2\b3'
    });
    t.same(ExtendedJSON.parse(str), JSON.parse(str));
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

test('stringify complex', t => {
    const object = {
        a: 3,
        b: [
            {
                c: [
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
        c: '1\n2\b3'
    };
    t.same(ExtendedJSON.stringify(object), JSON.stringify(object));
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
