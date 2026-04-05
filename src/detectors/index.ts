export { emptyErrorHandler } from "./empty-error-handler.js";
export { trivialAssertion } from "./trivial-assertion.js";
export { insecureDefaults } from "./insecure-defaults.js";
export { undeclaredImport } from "./undeclared-import.js";
export { overDefensiveCoding } from "./over-defensive-coding.js";
export { excessiveCommentRatio } from "./excessive-comment-ratio.js";
export { overMocking } from "./over-mocking.js";
export { nPlusOneQuery } from "./n-plus-one-query.js";
export { uncheckedDbResult } from "./unchecked-db-result.js";
export { deadCodePath } from "./dead-code-path.js";
export { doubleTypeAssertion } from "./double-type-assertion.js";
export { excessiveAny } from "./excessive-any.js";
export { debugConsoleInProd } from "./debug-console-in-prod.js";
export { todoInProduction } from "./todo-in-production.js";
export { placeholderInProduction } from "./placeholder-in-production.js";
export { tokenInLocalstorage } from "./token-in-localstorage.js";
export { godComponent } from "./god-component.js";
export { godFunction } from "./god-function.js";
export { sqlInjection } from "./sql-injection.js";
export { dangerousInnerHtml } from "./dangerous-inner-html.js";
export { unboundedQuery } from "./unbounded-query.js";
export { mixedConcerns } from "./mixed-concerns.js";
export { unsafeShellExec } from "./unsafe-shell-exec.js";
export { llmCallNoTimeout } from "./llm-call-no-timeout.js";
export { dynamicCodeExec } from "./dynamic-code-exec.js";
export { llmUnpinnedModel } from "./llm-unpinned-model.js";
export { llmNoSystemMessage } from "./llm-no-system-message.js";
export { llmTemperatureNotSet } from "./llm-temperature-not-set.js";
export { hallucinatedPackage } from "./hallucinated-package.js";
export { assertionRoulette } from "./assertion-roulette.js";
export { sleepyTest } from "./sleepy-test.js";
export { snapshotOnlyTest } from "./snapshot-only-test.js";
export { emptyTest } from "./empty-test.js";
export { conditionalTestLogic } from "./conditional-test-logic.js";
export { noErrorPathTest } from "./no-error-path-test.js";

import type { Detector } from "../types.js";
import { emptyErrorHandler } from "./empty-error-handler.js";
import { trivialAssertion } from "./trivial-assertion.js";
import { insecureDefaults } from "./insecure-defaults.js";
import { undeclaredImport } from "./undeclared-import.js";
import { overDefensiveCoding } from "./over-defensive-coding.js";
import { excessiveCommentRatio } from "./excessive-comment-ratio.js";
import { overMocking } from "./over-mocking.js";
import { nPlusOneQuery } from "./n-plus-one-query.js";
import { uncheckedDbResult } from "./unchecked-db-result.js";
import { deadCodePath } from "./dead-code-path.js";
import { doubleTypeAssertion } from "./double-type-assertion.js";
import { excessiveAny } from "./excessive-any.js";
import { debugConsoleInProd } from "./debug-console-in-prod.js";
import { todoInProduction } from "./todo-in-production.js";
import { placeholderInProduction } from "./placeholder-in-production.js";
import { tokenInLocalstorage } from "./token-in-localstorage.js";
import { godComponent } from "./god-component.js";
import { godFunction } from "./god-function.js";
import { sqlInjection } from "./sql-injection.js";
import { dangerousInnerHtml } from "./dangerous-inner-html.js";
import { unboundedQuery } from "./unbounded-query.js";
import { mixedConcerns } from "./mixed-concerns.js";
import { unsafeShellExec } from "./unsafe-shell-exec.js";
import { llmCallNoTimeout } from "./llm-call-no-timeout.js";
import { dynamicCodeExec } from "./dynamic-code-exec.js";
import { llmUnpinnedModel } from "./llm-unpinned-model.js";
import { llmNoSystemMessage } from "./llm-no-system-message.js";
import { llmTemperatureNotSet } from "./llm-temperature-not-set.js";
import { hallucinatedPackage } from "./hallucinated-package.js";
import { assertionRoulette } from "./assertion-roulette.js";
import { sleepyTest } from "./sleepy-test.js";
import { snapshotOnlyTest } from "./snapshot-only-test.js";
import { emptyTest } from "./empty-test.js";
import { conditionalTestLogic } from "./conditional-test-logic.js";
import { noErrorPathTest } from "./no-error-path-test.js";

/** All built-in detectors */
export const builtinDetectors: Detector[] = [
  emptyErrorHandler,
  trivialAssertion,
  insecureDefaults,
  undeclaredImport,
  overDefensiveCoding,
  excessiveCommentRatio,
  overMocking,
  nPlusOneQuery,
  uncheckedDbResult,
  deadCodePath,
  doubleTypeAssertion,
  excessiveAny,
  debugConsoleInProd,
  todoInProduction,
  placeholderInProduction,
  tokenInLocalstorage,
  godComponent,
  godFunction,
  sqlInjection,
  dangerousInnerHtml,
  unboundedQuery,
  mixedConcerns,
  unsafeShellExec,
  llmCallNoTimeout,
  dynamicCodeExec,
  llmUnpinnedModel,
  llmNoSystemMessage,
  llmTemperatureNotSet,
  hallucinatedPackage,
  assertionRoulette,
  sleepyTest,
  snapshotOnlyTest,
  emptyTest,
  conditionalTestLogic,
  noErrorPathTest,
];
