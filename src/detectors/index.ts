export { emptyErrorHandler } from "./empty-error-handler.js";
export { trivialAssertion } from "./trivial-assertion.js";
export { insecureDefaults } from "./insecure-defaults.js";

import type { Detector } from "../types.js";
import { emptyErrorHandler } from "./empty-error-handler.js";
import { trivialAssertion } from "./trivial-assertion.js";
import { insecureDefaults } from "./insecure-defaults.js";

/** All built-in detectors */
export const builtinDetectors: Detector[] = [
  emptyErrorHandler,
  trivialAssertion,
  insecureDefaults,
];
