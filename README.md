# Release Guardian

An agent that decides whether a release is safe to ship — and refuses to let a model
*narrate* that decision. Every check is read from a system of record or actually
executed; the two moments that matter (shipping, communicating) are the two moments
a human is asked.

Built on [TrueForge](https://github.com/truefoundry/trueforge) for the WeMakeDevs
**Agent Harness** hackathon (TrueForge + Qodo).

> ⚠️ **Local mode only.** The demo runs TrueForge in local (SQLite, no-login) mode.
> This is not a production configuration — see the TrueForge docs. Called out here as
> a scoping decision, not an oversight (PRD §16).

## What it does

Given a release candidate (branch / tag / PR ref), Release Guardian:

1. Fans out three parallel subagents — **Freeze Check**, **Readiness Check**,
   **Rollback Check** — each reading from real systems (GitHub, PagerDuty, Google
   Calendar, feature flags) and reporting failed lookups as *unknown*, never as pass.
2. **Verifies rollback by executing it** — the Rollback subagent runs the candidate's
   `down` migrations against a throwaway DB in a Daytona sandbox and checks parity.
3. Aggregates the three structured results into one **risk score in Python (Code Mode)** —
   counts and rules, not prose.
4. **Gate 1** — pauses for a human to approve / deny / override the go-no-go.
5. Drafts the release comms (Slack summary + stakeholder email).
6. **Gate 2** — pauses again before the comms are handed off to send.
7. If blocked, schedules a nightly re-check; each trigger is a fresh session that
   reloads the candidate and re-surfaces it once unblocked.

## Layout

```
agents/release-guardian.json    Agent spec, applied to TrueForge via the SDK
packages/guardian-actions/      Custom MCP server: the two approval gates + app store
packages/mock-connectors/       Mock Calendar + PagerDuty (freeze windows, on-call, incidents)
scripts/apply-agent.mjs         Create/update the agent on a running server
scripts/setup-providers.mjs     Configure model providers / Daytona / MCP servers via the SDK
scripts/smoke-freeze.mjs        End-to-end check of the Freeze Check
fixtures/sample-repo/           Demo repo incl. a deliberately-irreversible migration
ui/                             Custom UI on the TrueForge UI SDK (level 2)
```

## Mock connectors

`packages/mock-connectors` stands in for Google Calendar + PagerDuty until the real
OAuth servers are wired (they mirror the real API shapes, so swapping is a connector
config change, not an agent change). `MOCK_SCENARIO` selects the world:

| Scenario | Meaning |
| --- | --- |
| `clear` | no freeze window, no blocking incident |
| `freeze` | an active `FREEZE:` calendar window |
| `incident` | a triggered high-urgency PagerDuty incident |

## Quick start

```bash
cp .env.example .env            # then edit
npm install
npm run guardian:dev            # guardian-actions MCP on :9100

# in TrueForge: Settings -> Connectors -> Add MCP Server -> http://localhost:9100/mcp
npm run agent:apply             # create/update the "release-guardian" agent
```

## Qodo Code Review Evidence

<!-- Populated from PR history — links to merged PRs with completed Qodo reviews. -->
_See PR history; every substantive change went through a reviewed pull request._
