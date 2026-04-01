// === Should be flagged ===

// Empty catch block
try {
  riskyOperation();
} catch (e) {}

// Console.log-only catch block
try {
  riskyOperation();
} catch (e) {
  console.log(e);
}

// Console.error-only catch block
try {
  riskyOperation();
} catch (e) {
  console.error(e);
}

// Console.warn-only catch block
try {
  riskyOperation();
} catch (e) {
  console.warn(e);
}

// === Should NOT be flagged ===

// Has a comment — intentionally empty
try {
  riskyOperation();
} catch (e) {
  /* intentionally empty */
}

// Re-throws the error
try {
  riskyOperation();
} catch (e) {
  throw new Error("Failed");
}

// Has recovery logic (return)
try {
  riskyOperation();
} catch (e) {
  return fallbackValue;
}

// Multiple statements including re-throw
try {
  riskyOperation();
} catch (e) {
  cleanup();
  throw e;
}

// Has line comment — intentionally empty
try {
  riskyOperation();
} catch (e) {
  // ignore this error
}

function riskyOperation() {}
function cleanup() {}
const fallbackValue = null;
