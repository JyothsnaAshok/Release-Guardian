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

The base ref is the last release (a tag). Call `github.list_tags` with the exact
`owner` and `repo` (they are given to you — do not guess). If the base tag name
appears in the list => `true`. If the list is returned and the tag is absent =>
`false`. Only `"unknown"` if the call itself errored. (In the sandbox clone,
`git tag --list` is a second confirmation.)

## 2. migration_reversible — the sandbox dry-run

The demo repos are **public**. Run this **one script** in the sandbox shell,
substituting the clone URL and candidate ref you were given. Do not improvise the
steps — run it exactly, once:

```bash
set -o pipefail
CLONE_URL="https://github.com/<owner>/<repo>.git"; REF="<candidate-ref>"
rm -rf /work
if ! GIT_TERMINAL_PROMPT=0 git clone --depth 50 "$CLONE_URL" /work 2>&1; then
  echo "__RG__ migration_reversible=unknown  (clone failed)"; exit 0
fi
cd /work && git checkout -q "$REF" 2>&1 || { echo "__RG__ migration_reversible=unknown  (checkout failed)"; exit 0; }
if ls migrations/*_up.sql >/dev/null 2>&1; then
  npm ci --silent 2>&1 | tail -3
  OUT=$(node scripts/migrate.mjs verify-rollback /tmp/rb.sqlite 2>&1); RC=$?
elif [ -f scripts/verify-rollback.mjs ]; then
  npm ci --omit=dev --silent 2>&1 | tail -3 || true
  OUT=$(npm run --silent verify-rollback 2>&1); RC=$?
else
  echo "__RG__ migration_reversible=unknown  (no verify-rollback in repo)"; exit 0
fi
echo "$OUT" | tail -40
[ $RC -eq 0 ] && echo "__RG__ migration_reversible=true" || echo "__RG__ migration_reversible=false"
```

Read the `__RG__` marker line for the verdict, and use everything above it (the last
40 lines of real output) as `dry_run_output`. On `false`, pull the failing migration
name / reason from that output into `failing_migration`.

You MUST run this — do not assume an outcome and do not hand-analyse the diff
instead. `save_check_result` rejects a boolean `migration_reversible` without a
non-empty `dry_run_output`. Only report `"unknown"` (with `dry_run_output: null`)
when the script itself printed an `unknown` marker or could not be run at all.
Never report `true` because you could not run it.

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
  "runbook_current": false,
  "dry_run_output": "> node scripts/migrate.mjs verify-rollback ...\nLOSS: migration 0003 does not reverse cleanly.\n..."
}
```

All six fields required. Use `"unknown"` (never `false`) for any check whose lookup
or dry-run could not run, and name it in `unknown_fields`. `failing_migration` is
`null` when `migration_reversible` is `true`; `dry_run_output` is `null` only when
`migration_reversible` is `"unknown"`.
