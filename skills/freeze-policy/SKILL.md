---
name: freeze-policy
description: Org/team blackout rules, incident freezes, and concurrent-deploy conflicts. Loaded when the Freeze Check runs.
---

# Freeze Policy

You are running the **Freeze Check**. Decide whether the org is currently in a state
that blocks the release. Read every fact from a tool — never assume.

## Tools

- `calendar_list_events` — freeze windows live here.
- `pagerduty_list_oncalls` — who is on call now.
- `pagerduty_list_incidents` — active incidents.

Call `calendar_list_events` with `time_min` = now and `time_max` = now + 2h.

## Rules

A release is **in freeze** if any of these is true:

1. **Calendar freeze** — an all-day event on the `Release Freezes` calendar whose
   `summary` starts with `FREEZE:` overlaps the next 60 minutes.
2. **Incident freeze** — `pagerduty_list_incidents` returns any incident with
   `urgency: "high"` and `status` of `triggered` or `acknowledged` (i.e. not resolved).
3. **Weekend freeze** — the current time is between Fri 16:00 and Mon 09:00 in the
   on-call user's implied timezone (use UTC if unknown).

## Concurrent-deploy conflict

Report (do not auto-resolve) any other `FREEZE:`-adjacent or deploy-window event that
overlaps the next 60 minutes. There is no separate deploy registry in this environment,
so this is calendar-only for now.

## Output — call `guardian-actions.save_check_result`

`kind: "freeze"`, and `result` exactly this shape:

```json
{
  "in_freeze": true,
  "reasons": ["calendar_freeze: FREEZE: production incident retro — no deploys (ends 2026-09-02)"],
  "window": { "start": "2026-08-29", "end": "2026-09-02" },
  "conflicting_deploys": [],
  "oncall": { "name": "Dana Ruiz", "email": "dana.ruiz@demo.dev" }
}
```

- Every field above is **required** — always send all five. There are no defaults; an
  omitted field is rejected.
- `in_freeze` is `true`, `false`, or the string `"unknown"` — use `"unknown"` only when
  a required lookup failed. **Never report `false` because a tool call errored.**
- For any field you could not determine, set its value to `null` (this includes the
  array fields `reasons` and `conflicting_deploys`) and name it in the `unknown_fields`
  array of the `save_check_result` call (e.g. `["oncall"]`).
- `window` is `null` when `in_freeze` is `false`.
- `reasons` / `conflicting_deploys` are `[]` when the lookup succeeded and found nothing,
  and `null` (plus listed in `unknown_fields`) when the lookup failed. When `in_freeze`
  is `true`, `reasons` has one human-readable string per triggered rule, prefixed with
  the rule name (`calendar_freeze`, `incident_freeze`, `weekend_freeze`).
