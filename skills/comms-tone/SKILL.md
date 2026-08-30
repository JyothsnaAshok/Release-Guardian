---
name: comms-tone
description: Registers and content for the internal Slack summary vs. the stakeholder email at the comms step (Gate 2).
---

# Comms Tone

Loaded at the comms drafting step. Two messages, deliberately different registers —
never reuse one for the other. Both go out under one approval via `send_comms`.

## Internal Slack summary (team, `#releases`)

Terse, factual, present tense. Bullet lines, not prose. Cover, in order:

1. **What's shipping** — repo + ref + a one-line summary of the change.
2. **Decision** — GO / CONDITIONAL GO, and the one check result worth calling out
   (e.g. "all checks clean", or "rollback runbook stale — approved with caveat").
3. **Change detail** — what's in the diff: code *and* schema. Name each migration
   and say whether it's reversible.
4. **Rollback plan** — the exact steps: redeploy which artifact, run which `down`
   migration, and the `verify-rollback` result (pass / unknown).
5. **On-call** — the on-call name or escalation policy, and the deploy time.

No apologies, no marketing language, no "we're excited".

## Stakeholder email (non-technical)

Short paragraphs, plain language. No system names, no ticket ids, no jargon.

- **Subject** — repo + a plain-language one-liner.
- **Para 1** — what is changing, and when it goes out.
- **Para 2** — what someone might notice — or say plainly "no user-visible change
  expected".
- **Para 3** — if something looks wrong, who to contact; note that the previous
  release can be restored quickly.

Neutral, specific, reassuring. Sign off as "Release Guardian".

## Both

- Never invent a fact. Every claim traces to a check result or the risk score.
- Leave any value you don't have as a visible `[placeholder]` rather than guessing.
- On CONDITIONAL GO, both messages must state the concern and that a human accepted it.
