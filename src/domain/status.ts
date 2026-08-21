/**
 * The outcome of one validation step.
 *
 * `unsupported` and `not_run` are ordinary results, not failures: an engine
 * never turns absence of knowledge into an invalidity (`engine.md` section 2).
 */
export const STEP_STATUSES = ["valid", "invalid", "unsupported", "not_run"] as const;

/** The outcome of one validation step. */
export type StepStatus = (typeof STEP_STATUSES)[number];

/** The step a result belongs to. */
export const VALIDATION_LEVELS = ["format", "checksum", "registry"] as const;

/** The step a result belongs to. */
export type ValidationLevel = (typeof VALIDATION_LEVELS)[number];
