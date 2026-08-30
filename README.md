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

1. Fans out two parallel **subagents** — **Freeze Check** (calendar + incidents) and
   **Readiness Check** (GitHub diff / CI / migrations / incidents) — each reporting a
   failed lookup as *unknown*, never as pass.
2. Runs the **Rollback Check** in the main context: **verifies rollback by executing
   it** — clones the candidate in a Daytona **sandbox** and runs its `verify-rollback`
   (SQL `down`-migration parity, or a code round-trip). `migration_reversible` comes
   from the exit code and the saved result carries the verbatim run output — the
   verdict cannot be asserted without the evidence.
3. Aggregates the three structured results into one **RiskScore in Python (Code
   Mode)** — counts and rules (blockers / concerns / unknowns), not prose.
4. **Gate 1** — renders the decision as a **Generative UI** card, then asks the human
   (approve / override to go / conditional-go / no-go / cancel). Fires on every
   decision, including `no_go`.
5. On go / conditional-go: drafts **one internal release email** (engineering /
   on-call audience — technical, carries the full rollback plan) as a Generative UI
   preview card.
6. **Gate 2** — asks again before the email goes out. On approval it is **sent for
   real over Gmail**.
7. On no_go: schedules a nightly re-check; each trigger is a fresh session that
   reloads the candidate from the store and re-surfaces it once unblocked.

The UI is TrueForge's own chat UI (`localhost:8790`) — the agent is tuned so its
visible output is just the two cards (decision + email); the tool calls, sandbox
runs and Code Mode sit in the collapsed **Agent Steps** panel.

## Layout

```
agents/release-guardian.json    Agent spec, applied to TrueForge via the SDK
packages/guardian-actions/      Custom MCP server: the two approval gates + app store
packages/composio-bridge/       Real Google Calendar + Gmail via the Composio SDK (local MCP)
packages/pagerduty-mock/        Mock PagerDuty (on-call, incidents)
scripts/apply-agent.mjs         Create/update the agent on a running server
scripts/setup-providers.mjs     Configure model providers / Daytona / MCP servers via the SDK
scripts/smoke-{freeze,readiness,rollback}.mjs   Per-check end-to-end smoke tests
scripts/smoke-e2e.mjs           Full pipeline against the real agent (checks -> aggregate -> gates)
fixtures/sample-repo/           Seed for the demo repos (see below)
skills/                         freeze-policy · rollback-runbook-format · comms-tone
```

## Demo repos (the release candidates under test)

The agent analyses real GitHub repos, not fixtures:

| Repo | Case | Candidate branch |
| --- | --- | --- |
| [`orders-service`](https://github.com/JyothsnaAshok/orders-service) `release/v1.3.0` | SQL migration — `0003` drops a column with live data and cannot be faithfully reversed → **NO-GO** | vs tag `v1.2.0` |
| [`orders-service`](https://github.com/JyothsnaAshok/orders-service) `release/v1.4.0` | Clean release — reversible migration + a current rollback runbook → **GO**, drafts the release email, Gate 2 | vs tag `v1.2.0` |
| [`checkout-api`](https://github.com/JyothsnaAshok/checkout-api) `release/v2.1.0` | Pure code — persisted-state format moves to `v2`; the upgrade is safe and CI is green, but a rollback strands the service → **NO-GO** | vs tag `v2.0.0` |

CI is green on all three — a human would ship them. On `v1.3.0` / `v2.1.0` the
Rollback Check is what catches that they can't be undone.

The GitHub connector is registered as two MCP servers (`github` for repo/commit/PR
reads, `github-actions` for CI status — GitHub's remote MCP splits the actions toolset
onto its own endpoint). Both use one fine-grained read-only PAT (`GITHUB_PAT`).

## Connectors

**Calendar + Gmail are real, via Composio.** `packages/composio-bridge` wraps the
Composio SDK and exposes `calendar_list_events` (Google Calendar `events.list`) on a
local MCP for the Freeze Check; the real Gmail send lives inside `guardian-actions`
`send_comms` and fires on Gate 2 approval. Link a Google account in the Composio
dashboard, then set `COMPOSIO_API_KEY` + `COMPOSIO_USER_ID` (see `.env.example`). A
freeze is any calendar event whose title starts with `FREEZE:`. Without
`COMPOSIO_API_KEY`, `send_comms` falls back to a mock send.

**PagerDuty is still mocked.** `packages/pagerduty-mock` mirrors the real API shapes,
so swapping in a real PagerDuty MCP is a connector-config change, not an agent change.
`PAGERDUTY_SCENARIO` selects the world:

| Scenario | Meaning |
| --- | --- |
| `clear` | one auto-resolved incident — nothing blocking (default) |
| `incident` | a triggered high-urgency incident |

## Quick start

```bash
cp .env.example .env      # MODEL_API_KEY, DAYTONA_API_KEY, GITHUB_PAT, COMPOSIO_API_KEY, COMPOSIO_USER_ID
npm install

npx @truefoundry/trueforge@latest   # terminal 1 — TrueForge on :8790
npm run guardian:dev                # terminal 2 — guardian-actions MCP on :9100
npm run pagerduty:dev               # terminal 3 — pagerduty-mock MCP on :9200
npm run composio:dev                # terminal 4 — composio-bridge MCP on :9300

npm run setup:providers             # model provider + Daytona + all MCP servers + skills, via the SDK
npm run agent:haiku                 # apply the agent on Haiku (cheap); agent:sonnet for the final demo
```

Then open TrueForge (`http://localhost:8790`), pick **release-guardian** from the
Agents Library, and paste a candidate:

```
Evaluate this release candidate.

Repo: https://github.com/JyothsnaAshok/orders-service
Candidate ref: release/v1.3.0
Previous release: v1.2.0
Target deploy: 2026-09-15T14:00:00Z
Candidate id: rc-1301
```

Leave out `Target deploy` (or write `Deploy now`) to evaluate against the current
freeze window instead. `setup:providers` configures everything reachable over the
API; the only manual step is linking the Google account in the Composio dashboard.
Run `npm run smoke:e2e` for a full unattended pipeline check.

> Skills are git-cloned into the sandbox on init, so **`Release-Guardian` must be a
> public repo** for the Rollback Check's dry-run to run.

## Qodo Code Review Evidence

<!-- Populated from PR history — links to merged PRs with completed Qodo reviews. -->
_See PR history; every substantive change went through a reviewed pull request._
