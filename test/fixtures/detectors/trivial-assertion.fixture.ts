// === Should be flagged (trivial assertions) ===

// Literal true === true
expect(true).toBe(true);

// Literal false === false
expect(false).toBe(false);

// Number literal === same number
expect(1).toBe(1);

// String literal === same string
expect("foo").toBe("foo");

// toEqual with same literal
expect(42).toEqual(42);

// toBeTruthy with true — tautological
expect(true).toBeTruthy();

// toBeFalsy with false — tautological
expect(false).toBeFalsy();

// === Should NOT be flagged ===

// Variable, not literal
expect(result).toBe(true);

// Different literals
expect(1).toBe(2);

// Variable in both positions
expect(a).toBe(b);

// Different strings
expect("foo").toBe("bar");

// Method call result
expect(getValue()).toBe(true);

// toBeTruthy with variable
expect(result).toBeTruthy();

const result = true;
const a = 1;
const b = 2;
function getValue() { return true; }
