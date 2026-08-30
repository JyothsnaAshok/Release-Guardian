---
name: freeze-policy
description: Org/team blackout rules, incident freezes, and concurrent-deploy conflicts. Loaded when the Freeze Check runs.
---

# Freeze Policy

You are running the **Freeze Check**. Decide whether the release is blocked by a
freeze *for its planned deploy time*. Read every fact from a tool — never assume.

## The deploy window

The candidate carries a `target_deploy_at` (an ISO instant) or `null` for "ship now".
Let `T` = `target_deploy_at` if set, else now. The **deploy window** is `[T, T + 2h]`.
Every overlap check below is against this window — not "right now".

## Tools

- `calendar_list_events` (the **`composio`** server — real Google Calendar) — call with
  `time_min` = `T`, `time_max` = `T + 2h`. The response has a top-level `events` array
  (every page already followed and merged), each with `summary`, `start`, `end`; `result`
  holds the last raw Composio page for reference. A freeze is any event whose `summary`
  starts with `FREEZE:`. If the call returns `error` (including the "result is incomplete"
  guard), set `in_freeze` to `"unknown"` and list it — never fall back to `false`.
- `pagerduty_list_incidents` (the **`pagerduty`** server) — active incidents.
- `pagerduty_list_oncalls` (the **`pagerduty`** server) — for the `oncall` field.

If the `composio` calendar call errors or returns no usable payload, set `in_freeze`
to `"unknown"` and list it in `unknown_fields` — never fall back to `false`.

## Rules

A release is **in freeze** if any of these is true:

1. **Calendar freeze** — a Google Calendar event whose `summary` starts with
   `FREEZE:` overlaps the deploy window.
2. **Incident freeze** — only when the deploy window includes now: `pagerduty_list_incidents`
   returns any incident with `urgency: "high"` and `status` not `resolved`. (A future
   deploy is not blocked by an incident that may be resolved by then — but note it in
   `reasons` as a watch item if `in_freeze` is otherwise false.)

Blackout windows (weekends, holidays) are expressed as `FREEZE:` calendar events by
whoever owns the release calendar — they are covered by rule 1, so do not apply a
separate day-of-week rule here.

## Concurrent-deploy conflict

Report (do not auto-resolve) any other `FREEZE:`-adjacent or deploy-window event that
overlaps the deploy window. There is no separate deploy registry here, so this is
calendar-only for now.

## Output — call `guardian-actions.save_check_result`

`kind: "freeze"`, and `result` exactly this shape:

```json
{
  "in_freeze": true,
  "reasons": ["calendar_freeze: FREEZE: production incident retro — no deploys (2026-08-29 to 2026-09-02), overlaps deploy window 2026-08-31T18:00Z"],
  "window": { "start": "2026-08-29", "end": "2026-09-02" },
  "conflicting_deploys": [],
  "oncall": { "name": "Dana Ruiz", "email": "dana.ruiz@demo.dev" }
}
```

- Whenever `target_deploy_at` was set, put "evaluated for <that date>" in the first
  `reasons` entry (even when `in_freeze` is `false`, so the operator sees which date
  was checked).

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
  the rule name (`calendar_freeze`, `incident_freeze`).
