import { z } from 'zod';

/**
 * Structured shapes for the three subagent check results (PRD §7).
 *
 * The core safety rule (PRD §7.1): a value that could not be determined is the
 * string `"unknown"` or `null` with the field named in `unknown_fields` — it is
 * NEVER silently a passing value. `save_check_result` enforces the shape and
 * rejects a result whose headline boolean is missing.
 *
 * Every field is required — there are no defaults. An omitted field would let an
 * incomplete lookup persist as if it had been determined, so the caller must
 * state each value explicitly (`null` / `"unknown"` for anything it could not
 * establish, with the field named in `unknown_fields`).
 */

const tri = z.union([z.boolean(), z.literal('unknown')]);
/** An evidence list, or `null` when the lookup that would populate it failed. */
const evidence = z.array(z.string()).nullable();

export const FreezeCheckResult = z
  .object({
    in_freeze: tri,
    reasons: evidence,
    window: z.object({ start: z.string(), end: z.string() }).nullable(),
    conflicting_deploys: evidence,
    oncall: z.object({ name: z.string(), email: z.string() }).nullable(),
  })
  .strict();

export const ReadinessCheckResult = z
  .object({
    tests_pass: tri,
    open_incidents: evidence,
    has_migration: tri,
    diff_summary: z.string().nullable(),
  })
  .strict();

export const RollbackCheckResult = z
  .object({
    prior_artifact_exists: tri,
    migration_reversible: tri,
    failing_migration: z.string().nullable(),
    flags_default_safe: tri,
    runbook_current: tri,
  })
  .strict();

export const CHECK_SCHEMAS = {
  freeze: FreezeCheckResult,
  readiness: ReadinessCheckResult,
  rollback: RollbackCheckResult,
} as const;

export type CheckKind = keyof typeof CHECK_SCHEMAS;

/** Headline field per kind — must not be missing, may be `"unknown"`. */
export const HEADLINE_FIELD: Record<CheckKind, string> = {
  freeze: 'in_freeze',
  readiness: 'tests_pass',
  rollback: 'migration_reversible',
};
