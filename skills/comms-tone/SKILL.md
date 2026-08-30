---
name: comms-tone
description: Templates and registers for the internal Slack summary vs. the stakeholder email. Loaded at the comms drafting step.
---

# Comms Tone

Loaded on demand at the comms drafting step. The two messages are deliberately
different registers — do not reuse one for the other.

## Internal Slack summary (team)

- Terse, factual, present tense. Bullets, not prose.
- Include: what's shipping (1 line), computed risk summary (the score + top 2 factors),
  rollback plan if risk is non-green, on-call handle.
- No apologies, no marketing language.

## Stakeholder email (non-technical)

- Short paragraphs, plain language, no jargon or ticket IDs.
- Structure: what is changing / when / what you might notice / what to do if something
  looks wrong (who to contact).
- Neutral, reassuring, specific. No internal system names.

## Both

- Never invent facts. Every claim traces to a subagent result or the risk score.
- Leave `[on-call: …]` and other unresolved fields as visible placeholders rather
  than guessing.
