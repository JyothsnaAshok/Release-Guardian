---
name: freeze-policy
description: Org/team blackout rules and what counts as a concurrent-deploy conflict. Loaded when the Freeze Check subagent starts.
---

# Freeze Policy

Loaded on demand by the Freeze Check subagent. Keep this file the single source of
truth for freeze rules — do not put freeze logic in the agent instructions.

## Blackout windows

- **Weekend freeze:** no releases Fri 16:00 → Mon 09:00 in the release owner's tz.
- **Holiday freezes:** any all-day calendar event on the `Release Freezes` calendar
  whose title starts with `FREEZE:`.
- **Incident freeze:** any PagerDuty incident of urgency `high` that is not resolved.

## Concurrent-deploy conflict

Another release is "concurrent" if its window overlaps the next 60 minutes AND it
touches an overlapping service/package path. Report it; do not auto-resolve.

## Unknowns

If the calendar or PagerDuty lookup fails, report `in_freeze: "unknown"` for that
source. Never assume "not in freeze" on a failed lookup.
