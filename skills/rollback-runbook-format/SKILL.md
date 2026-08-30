---
name: rollback-runbook-format
description: How the Rollback Check verifies a release can actually be undone — the sandbox dry-run, the runbook contract, and the result shape.
---

# Rollback Check

You are running the **Rollback Check**. Decide whether this release could actually be
undone if it went wrong. Verify by executing, not by reading that something exists.

## Tools

- `github.get_file_contents` / `github.list_tags` / `github.get_release_by_tag` — repo reads.
- The **sandbox** (shell + files) — clone the candidate and run its rollback check.

## 1. prior_artifact_exists

The base ref is the last release (a tag). `github.list_tags` (or `get_release_by_tag`)
for the repo — does the base tag exist and resolve to a commit? true / false /
"unknown" if the lookup errored.

## 2. migration_reversible — the sandbox dry-run

In the sandbox:

```
git clone <repo-clone-url> /work && cd /work && git checkout <candidate-ref>
```

Then, depending on the repo:

- **SQL migrations** (`migrations/*_up.sql` + `*_down.sql` present):
  `npm ci && node scripts/migrate.mjs verify-rollback /tmp/rb.sqlite`
- **Code / persisted-state** (`scripts/verify-rollback.mjs` present, no migrations):
  `npm ci --omit=dev 2>/dev/null || true; npm run verify-rollback`

Exit code `0` => `migration_reversible: true`. Non-zero => `false`, and put the
failing migration name or the reason from stdout into `failing_migration`. If the
clone or the command cannot run at all => `"unknown"` and name it in unknown_fields.

`verify-rollback` already enforces full parity — schema **and** row-content (a `down`
that recreates a dropped column with a default restores the row count but loses the
values, and that must fail).

## 3. flags_default_safe

Does the diff add or change feature-flag configuration (a `flags/`, `*.flags.*`,
`launchdarkly`/`unleash` config)? If none: `true`. If it does: each new flag's default
must be the pre-release behaviour (so a rollback of the *code* leaves the flag inert).
Any flag defaulting to the new behaviour => `false`.

## 4. runbook_current

`github.get_file_contents` for `ROLLBACK.md`, `docs/rollback.md`, or `RUNBOOK.md` at
the candidate ref. Missing => `runbook_current: false`. Present => it is "current" only
if its last commit is within 90 days AND it names the release it was last exercised
against.

A valid runbook contains: the prior artifact ref; ordered, copy-pasteable revert
steps; for every migration a named `down` file or an explicit "forward-fix only"
statement; feature-flag names + safe defaults; the on-call escalation path.

## Output — `guardian-actions.save_check_result`, kind `"rollback"`

```json
{
  "prior_artifact_exists": true,
  "migration_reversible": false,
  "failing_migration": "0003_drop_status_column (row-content parity failed: status values lost)",
  "flags_default_safe": true,
  "runbook_current": false
}
```

All five fields required. Use `"unknown"` (never `false`) for any check whose lookup
or dry-run could not run, and name it in `unknown_fields`. `failing_migration` is
`null` when `migration_reversible` is `true`.
