// This file contains intentional anti-patterns for testing tractor rules

// [debug-console-in-prod] - should be caught
console.log("debugging user flow");
console.debug("trace info");
console.info("verbose output");

// [debug-console-in-prod] - these should NOT be caught
console.error("legitimate error");
console.warn("legitimate warning");

// [double-type-assertion] - should be caught
const config = someValue as unknown as AppConfig;
const data = response as any as UserData;

// [double-type-assertion] - should NOT be caught (single assertion is fine)
const name = value as string;

// [sql-injection-template] - should be caught
const user = await db.query(`SELECT * FROM users WHERE id = ${userId}`);
const rows = await db.execute(`DELETE FROM items WHERE name = ${name}`);

// [sql-injection-concat] - should be caught
const result = await db.query("SELECT * FROM users WHERE id = " + id);

// [sql-injection] - should NOT be caught (parameterized)
const safe = await db.query("SELECT * FROM users WHERE id = $1", [userId]);

// [eval-usage] - should be caught
eval(userInput);

// [tls-verification-disabled] - should be caught
const agent = new https.Agent({ rejectUnauthorized: false });

// [token-in-localstorage] - should be caught
localStorage.setItem("auth_token", jwt);
sessionStorage.setItem("jwt", refreshToken);

// [token-in-localstorage] - should NOT be caught
localStorage.setItem("theme", "dark");
localStorage.setItem("language", "en");

// [empty-catch-block] - should be caught
try {
  riskyOperation();
} catch (e) {
}

// [catch-block-log-only] - should be caught
try {
  anotherOp();
} catch (e) {
  console.log(e);
}

// [catch-block] - should NOT be caught (proper handling)
try {
  moreStuff();
} catch (e) {
  handleError(e);
  return fallback;
}

// [todo-in-production] - should be caught
// TODO: fix authentication bypass
// FIXME: this is a hack
// HACK: temporary workaround

// [god-function-params] - should be caught
function processOrder(
  userId: string,
  orderId: string,
  items: Item[],
  discount: number,
  shippingAddress: Address,
  billingAddress: Address,
  paymentMethod: PaymentInfo,
) {
  return true;
}

// [god-function-params] - should NOT be caught (<=5 params)
function simpleFunc(a: string, b: number, c: boolean) {
  return a + b;
}

// [n-plus-one-for-loop] - should be caught
for (const id of userIds) {
  const user = await db.findUnique({ where: { id } });
  processUser(user);
}

// [n-plus-one-async-map] - should be caught
const results = items.map(async (item) => {
  await db.create({ data: item });
});

// [n-plus-one] - should NOT be caught (no await in loop body)
for (const item of items) {
  processItem(item);
}
