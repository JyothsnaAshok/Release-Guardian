---
name: comms-tone
description: The single internal release email drafted at the comms step (Gate 2) — audience, structure, and what it must contain.
---

# Comms Tone

Loaded at the comms drafting step. There is exactly **one** message: an internal
release email to the engineering / release channel. No Slack post, no second
channel, no separate external version.

## Audience

Engineers and the on-call. Technical detail is expected — migration names, the
rollback procedure, flag defaults, CI state. Do not water it down for a
non-technical reader.

## The email

- **Subject** — repo + ref + the decision (e.g. `orders-service release/v1.4.0 —
  CONDITIONAL GO, deploying Sep 15`).
- **Body**, in this order:
  1. **What's shipping** — repo, ref, one-line summary of the change (code + schema).
  2. **Decision** — GO / CONDITIONAL GO, and the one check result worth calling out.
     On CONDITIONAL GO, state the concern in one line and that a human accepted it.
  3. **Change detail** — what's in the diff: code *and* schema. Name each migration
     and whether it is reversible (with the verify-rollback result).
  4. **Rollback plan** — the exact steps: which prior artifact to redeploy, which
     `down` migration to run, the `verify-rollback` outcome, and any flags to check.
  5. **Deploy window + on-call** — the planned time and who is on call.
- Sign off as **Release Guardian**.

## Rules

- Never invent a fact. Every claim traces to a check result or the risk score.
- Any value you don't have goes in as a visible `[placeholder]` — don't guess.
- No apologies, no "we're excited", no marketing language.
