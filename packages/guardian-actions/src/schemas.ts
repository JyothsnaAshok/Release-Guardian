import { z } from 'zod';

/**
 * Structured shapes for the three subagent check results (PRD §7).
 *
 * The core safety rule (PRD §7.1): a value that could not be determined is the
 * string `"unknown"` or `null` with the field named in `unknown_fields` — it is
 * NEVER silently a passing value. `save_check_result` enforces the shape and
 * rejects a result whose headline boolean is missing.
 */

const tri = z.union([z.boolean(), z.literal('unknown')]);

export const FreezeCheckResult = z
  .object({
    in_freeze: tri,
    reasons: z.array(z.string()).default([]),
    window: z
      .object({ start: z.string(), end: z.string() })
      .nullable()
      .default(null),
    conflicting_deploys: z.array(z.string()).default([]),
    oncall: z
      .object({ name: z.string(), email: z.string() })
      .nullable()
      .default(null),
  })
  .strict();

export const ReadinessCheckResult = z
  .object({
    tests_pass: tri,
    open_incidents: z.array(z.string()).default([]),
    has_migration: tri,
    diff_summary: z.string().nullable().default(null),
  })
  .strict();

export const RollbackCheckResult = z
  .object({
    prior_artifact_exists: tri,
    migration_reversible: tri,
    failing_migration: z.string().nullable().default(null),
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
