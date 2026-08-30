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

1. Fans out two parallel subagents — **Freeze Check** (calendar + incidents) and
   **Readiness Check** (GitHub diff / CI / migrations / incidents) — each reporting a
   failed lookup as *unknown*, never as pass.
2. Runs the **Rollback Check** in the main context: **verifies rollback by executing
   it** — clones the candidate in a Daytona sandbox and runs its `verify-rollback`
   (SQL `down`-migration parity, or a code round-trip). `migration_reversible` comes
   from the exit code and the saved result carries the verbatim run output — the
   verdict cannot be asserted without the evidence.
3. Aggregates the three structured results into one **RiskScore in Python (Code
   Mode)** — counts and rules (blockers / concerns / unknowns), not prose.
4. **Gate 1** — renders the decision card, then pauses for a human to approve / deny
   / override the go / no-go. Fires on every decision, including `no_go`.
5. On go / conditional-go: drafts the release comms (Slack summary + stakeholder
   email, different registers).
6. **Gate 2** — pauses again before both drafts are handed off to send, under one
   approval.
7. On no_go: schedules a nightly re-check; each trigger is a fresh session that
   reloads the candidate from the store and re-surfaces it once unblocked.

## Layout

```
agents/release-guardian.json    Agent spec, applied to TrueForge via the SDK
packages/guardian-actions/      Custom MCP server: the two approval gates + app store
packages/mock-connectors/       Mock Calendar + PagerDuty (freeze windows, on-call, incidents)
scripts/apply-agent.mjs         Create/update the agent on a running server
scripts/setup-providers.mjs     Configure model providers / Daytona / MCP servers via the SDK
scripts/smoke-{freeze,readiness,rollback}.mjs   Per-check end-to-end smoke tests
scripts/smoke-e2e.mjs           Full pipeline against the real agent (checks -> aggregate -> gates)
fixtures/sample-repo/           Seed for the demo repos (see below)
ui/                             The console — TrueForge UI SDK + brand theme + slot overrides
```

## The console (`ui/`)

`npm run ui:dev` (Vite, port 5273 — proxies the TrueForge API). The TrueForge UI SDK
pinned to the `release-guardian` agent, with a brand theme and two slot overrides:

- **`CheckLane`** — each parallel check renders as a labelled status lane
  (running / done / error), the visual proof of the harness's subagent fan-out.
- **`GateApprovalBar`** — an unmistakable banner on each of the two approval gates,
  so the operator sees *which* irreversible action they are signing off, before it
  runs. The Approve / Deny buttons are the harness's own tool-approval response —
  the gate is the real checkpoint, just given a purpose-built surface.

Streaming, session history, and the MCP-OAuth popups are the SDK's, unchanged.

## Demo repos (the release candidates under test)

The agent analyses real GitHub repos, not fixtures:

| Repo | Case | Candidate branch |
| --- | --- | --- |
| [`orders-service`](https://github.com/JyothsnaAshok/orders-service) | SQL migration — `0003` drops a column with live data and cannot be faithfully reversed | `release/v1.3.0` vs tag `v1.2.0` |
| [`checkout-api`](https://github.com/JyothsnaAshok/checkout-api) | Pure code — persisted-state format moves to `v2`; the upgrade is safe and CI is green, but a rollback strands the service | `release/v2.1.0` vs tag `v2.0.0` |

CI is green on both — a human would ship them. The Rollback Check is what catches that
they can't be undone.

The GitHub connector is registered as two MCP servers (`github` for repo/commit/PR
reads, `github-actions` for CI status — GitHub's remote MCP splits the actions toolset
onto its own endpoint). Both use one fine-grained read-only PAT (`GITHUB_PAT`).

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
cp .env.example .env            # fill in MODEL_API_KEY, DAYTONA_API_KEY, GITHUB_PAT
npm install

npx @truefoundry/trueforge@latest   # terminal 1 — TrueForge on :8790
npm run guardian:dev                # terminal 2 — guardian-actions MCP on :9100
npm run mocks:dev                   # terminal 3 — mock-connectors MCP on :9200

npm run setup:providers            # model provider + Daytona + all MCP servers + skills, via the SDK
npm run agent:apply                # create/update the "release-guardian" agent
npm run ui:dev                     # the console on :5273
```

`setup:providers` configures everything reachable over the API; the only manual step
is authorising any real OAuth connector under **Settings → Connectors**. Run
`npm run smoke:e2e` for a full unattended pipeline check.

## Qodo Code Review Evidence

<!-- Populated from PR history — links to merged PRs with completed Qodo reviews. -->
_See PR history; every substantive change went through a reviewed pull request._
