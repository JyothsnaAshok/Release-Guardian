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
CLONE_URL="https://github.com/<owner>/<repo>.git"; REF="<candidate-ref>"
command -v node >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq nodejs >/dev/null 2>&1; }
rm -rf /work
GIT_TERMINAL_PROMPT=0 git clone --depth 30 "$CLONE_URL" /work 2>&1 \
  && cd /work && git checkout -q "$REF" 2>&1 \
  || { echo "__RG__ unknown (clone/checkout failed)"; exit 0; }
if [ -f scripts/migrate.mjs ]; then
  OUT=$(node scripts/migrate.mjs verify-rollback 2>&1); RC=$?
elif [ -f scripts/verify-rollback.mjs ]; then
  OUT=$(node scripts/verify-rollback.mjs 2>&1); RC=$?
else
  echo "__RG__ unknown (no verify-rollback script)"; exit 0
fi
echo "$OUT" | tail -25
[ $RC -eq 0 ] && echo "__RG__ true" || echo "__RG__ false"
cd / && rm -rf /work    # free the checkout; the sandbox itself auto-stops when the turn ends
```

Both demo repos are zero-dependency — no `npm install` step. Read the `__RG__` marker
for the verdict (`true` / `false` / `unknown`), and the ~25 lines above it are
`dry_run_output`. On `false`, lift the failing migration name / reason into
`failing_migration`.

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

Send **exactly these six keys and no others**. Common mistakes to avoid:
`prior_artifact` is wrong — the key is `prior_artifact_exists`. There is no
`runbook_last_exercised` key — that fact goes into your `runbook_current` boolean.
Do not add, drop, or rename a key. Every boolean key is `true`, `false`, or the
string `"unknown"` — never a word like `"yes"`, a number, or an object.

All six fields required. Use `"unknown"` (never `false`) for any check whose lookup
or dry-run could not run, and name it in `unknown_fields`. `failing_migration` is
`null` when `migration_reversible` is `true` (include the key with value `null` —
do not omit it); `dry_run_output` is `null` only when `migration_reversible` is
`"unknown"`.
