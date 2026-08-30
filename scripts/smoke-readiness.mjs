// PR3 smoke test: run the Readiness Check end to end against the real GitHub
// connectors + the mock incident tracker, and assert the PERSISTED result (not the
// model's prose) reflects the demo repo's true state.
//
// Prereqs: TrueForge running; guardian-actions (:9100) and pagerduty (:9200)
// running and registered; github + github-actions connectors registered
// (GITHUB_PAT set, npm run setup:providers); a working model in RELEASE_GUARDIAN_MODEL.
//
// Target: JyothsnaAshok/orders-service, candidate release/v1.3.0 vs base tag v1.2.0.
// Expected true state: CI green, one migration touched (0003_drop_status_column),
// no unresolved high-urgency incident (PAGERDUTY_SCENARIO=clear).
//
// Usage: node --env-file=.env scripts/smoke-readiness.mjs

import { TrueForge } from '@truefoundry/trueforge-sdk';

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const guardianUrl = process.env.GUARDIAN_MCP_URL ?? 'http://localhost:9100/mcp';
const model = process.env.RELEASE_GUARDIAN_MODEL ?? 'anthropic/claude-haiku-4-5';
const REPO = process.env.SMOKE_REPO ?? 'JyothsnaAshok/orders-service';
const BASE = process.env.SMOKE_BASE ?? 'v1.2.0';
const HEAD = process.env.SMOKE_HEAD ?? 'release/v1.3.0';
const candidateId = `rc-readiness-smoke-${Date.now()}`;
const client = new TrueForge({ baseUrl, timeoutInSeconds: 360 });
const [owner, repo] = REPO.split('/');

const instructions = `You are running the Readiness Check for release candidate "${candidateId}".
The candidate is ${REPO} branch ${HEAD}; the last release is ${BASE}.

Steps, in order:
1. guardian-actions.get_release_candidate with candidate_id "${candidateId}" and ref "${HEAD}".
2. Migrations touched by the release: call github.get_file_contents for path "migrations/" at
   ref "${HEAD}" and again at ref "${BASE}". The migration files present at ${HEAD} but not at
   ${BASE} (compare the directory entry names) are what this release adds/changes. has_migration
   is true iff that set is non-empty; migrations is that list of paths. If either directory
   listing errors, set both has_migration = "unknown" and migrations = null.
3. diff_summary: github.list_commits for ${HEAD} (per_page 100) and for ${BASE} (per_page 100).
   The commits by SHA on ${HEAD} not on ${BASE} are the release's commits — summarise their
   messages in one line. If ${BASE}'s newest commit SHA does not appear in the ${HEAD} list,
   append " (partial)" to the summary.
4. tests_pass: resolve the candidate head SHA (github.list_commits ${HEAD} per_page 1 -> first
   sha). github-actions.actions_list workflow runs for that head SHA. tests_pass is true iff
   every run with status "completed" concluded "success"; "unknown" if any run is not completed
   or no runs are found; false if any completed run concluded other than "success".
5. open_incidents: pagerduty.pagerduty_list_incidents. An incident with urgency "high"
   and status not "resolved" is open — list "PD-<id>: <title>" for each. [] if the lookup
   succeeded and none match; null only if the lookup itself errored.
6. guardian-actions.save_check_result, kind "readiness", result:
   { tests_pass, open_incidents, has_migration, migrations, diff_summary }.
   All fields required. Arrays are [] when a successful lookup found nothing; null ONLY on a
   failed lookup (then name the field in unknown_fields). Booleans use "unknown", not false,
   on a failed lookup.
7. Reply with the final JSON you saved.`;

const { data: session } = await client.sessions.create({
  agent: {
    spec: {
      model: { name: model },
      instructions,
      mcp_servers: [
        { name: 'github', enable_tools: ['@read-only'] },
        { name: 'github-actions', enable_tools: ['@read-only'] },
        { name: 'pagerduty', enable_tools: ['@read-only'] },
        {
          name: 'guardian-actions',
          enable_tools: ['@all'],
          require_approval_for_tools: ['commit_release_decision', 'handoff_comms', 'send_comms'],
        },
      ],
      config: { sandbox: { enabled: false }, dynamic_sub_agents: { enabled: false } },
    },
  },
});

const stream = await client.sessions.createTurnStream(session.id, {
  input: [{ type: 'user.message', content: 'Run the readiness check.' }],
});
for await (const { data: e } of stream.withMetadata()) {
  if (e.type === 'turn.done') console.log(`[turn.done] ${e.state.status} ${e.state.message ?? ''}`);
}

// Assert against the PERSISTED result, fetched straight from guardian-actions —
// never the model's prose (Qodo PR3 #4).
async function callGuardian(name, args) {
  const res = await fetch(guardianUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: ')) ?? text;
  const payload = JSON.parse(line.replace(/^data: /, ''));
  return JSON.parse(payload.result.content[0].text);
}

const history = await callGuardian('get_release_candidate', { candidate_id: candidateId, ref: HEAD });
const readiness = [...(history.checks ?? [])].reverse().find((c) => c.kind === 'readiness');

console.log('\npersisted readiness result:', JSON.stringify(readiness, null, 2));

const r = readiness?.result ?? {};
const migrations = Array.isArray(r.migrations) ? r.migrations : [];
const checks = {
  persisted: Boolean(readiness),
  tests_pass: r.tests_pass === true,
  has_migration: r.has_migration === true,
  saw_0003: migrations.some((p) => /0003_drop_status_column/.test(p)),
  incidents_empty_not_null: Array.isArray(r.open_incidents) && r.open_incidents.length === 0,
};
const pass = Object.values(checks).every(Boolean);

console.log(`\n${pass ? 'PASS' : 'FAIL'} —`, checks);
process.exit(pass ? 0 : 1);
