---
name: rollback-runbook-format
description: What a valid rollback runbook must contain and how to check it is current. Loaded when the Rollback Check subagent starts.
---

# Rollback Runbook Format

Loaded on demand by the Rollback Check subagent.

## A valid runbook must contain

1. The previous known-good artifact reference (image tag / release id).
2. Explicit steps to revert, in order, copy-pasteable.
3. For every migration in the release: a named `down` migration file, or an explicit
   "not reversible — forward-fix only" statement with a reason.
4. Feature-flag names touched by the release and their safe default states.
5. On-call contact / escalation path.

## "Current" check

- `last_updated` within 90 days, AND
- links to (or names) the release it was last exercised against.

Missing either → `runbook_current: false`.

## Reversibility is verified, not asserted

Do not accept "we can roll back" from the runbook text. The subagent runs the `down`
migrations in the sandbox (PRD §9.7) and checks **full data parity** against the
pre-migration snapshot, not just structure:

- schema parity (same tables, columns, types, constraints, indexes), AND
- **row-content parity**: every affected table must match the snapshot cell-for-cell.
  Compare complete table contents — e.g. a deterministic `ORDER BY` dump or a per-table
  checksum (`md5`/`sha256` of the sorted rows). Row *count* alone is not sufficient: a
  `down` migration that recreates a dropped column with a default restores the count but
  loses the original values.

Any mismatch → `migration_reversible: false`. Only a dry-run that is identical on schema
*and* data sets `migration_reversible: true`.
