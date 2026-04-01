// === Should be flagged ===

// Disabling TLS verification
const httpsOptions = { rejectUnauthorized: false };

// eval usage
const result = eval("1 + 2");

// new Function usage
const fn = new Function("return 1");

// Hardcoded password
const password = "super_secret_123";

// Hardcoded api_key
const api_key = "sk-1234567890abcdef";

// Hardcoded token
const auth_token = "Bearer abc123";

// Weak cipher
const cipher = crypto.createCipheriv("des", key, iv);

// === Should NOT be flagged ===

// Environment variable for password
const dbPassword = process.env.PASSWORD;

// Empty string password (not a hardcoded secret)
const emptyPassword = "";

// rejectUnauthorized: true (safe)
const safeOptions = { rejectUnauthorized: true };

// Normal variable names with string values
const username = "admin";
const host = "localhost";

// Strong cipher
const safeCipher = crypto.createCipheriv("aes-256-gcm", key, iv);

// Non-credential variable
const description = "this is a password reset form";

declare const crypto: any;
declare const key: any;
declare const iv: any;
