// This test assigns an opaque type to lodash/underscore.
// This means that it will pass TypeScript's static analysis.
// But it won't pass the typings-checker, which doesn't allow 'any'.
var _;
// $ExpectType number
_.find([1, 2, 3], function (x) { return x * 1 == 3; });
// $ExpectError Operator '==' cannot be applied to types 'number' and 'string'.
_.find([1, 2, 3], function (x) { return x == 'a'; });
// $ExpectType number
_.find([1, 2, 3], 1);
// $ExpectError Property 'y' does not exist on type '{ x: number; }'.
_.find([{ x: 1 }, { x: 2 }, { x: 3 }], function (v) { return v.y == 3; });
// $ExpectType { x: number; }
_.find([{ x: 1 }, { x: 2 }, { x: 3 }], function (v) { return v.x == 3; });