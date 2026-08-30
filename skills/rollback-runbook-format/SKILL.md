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

The demo repos are **public** — clone over HTTPS with no credentials. Set
`GIT_TERMINAL_PROMPT=0` so a missing network fails fast instead of hanging on a
credential prompt. In the sandbox:

```
rm -rf /work
GIT_TERMINAL_PROMPT=0 git clone --depth 50 https://github.com/<owner>/<repo>.git /work
cd /work && git checkout <candidate-ref>
```

If the clone command exits non-zero, the dry-run could not run — go straight to the
`"unknown"` path below; do not analyse the diff by hand and guess.

Then, depending on the repo:

- **SQL migrations** (`migrations/*_up.sql` + `*_down.sql` present):
  `npm ci && node scripts/migrate.mjs verify-rollback /tmp/rb.sqlite`
- **Code / persisted-state** (`scripts/verify-rollback.mjs` present, no migrations):
  `npm ci --omit=dev 2>/dev/null || true; npm run verify-rollback`

You MUST actually run these in the sandbox — do not assume an outcome. Capture the
last ~40 lines of combined stdout/stderr; that goes verbatim into `dry_run_output`
and `save_check_result` will reject a boolean `migration_reversible` without it.

Exit code `0` => `migration_reversible: true`. Non-zero => `false`, and put the
failing migration name or the reason from stdout into `failing_migration`. If the
clone or the command genuinely cannot run (no sandbox, clone fails, toolchain
missing) => `migration_reversible: "unknown"`, `dry_run_output: null`, and name
`migration_reversible` in unknown_fields. Never report `true` because you could not
run it.

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
