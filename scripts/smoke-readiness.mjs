// PR3 smoke test: run the Readiness Check end to end against the real GitHub
// connectors + the mock incident tracker, and assert it persists a schema-valid
// result reflecting the demo repo's true state.
//
// Prereqs: TrueForge running; guardian-actions (:9100) and mock-connectors (:9200)
// running and registered; github + github-actions connectors registered
// (GITHUB_PAT set, npm run setup:providers); a working model in RELEASE_GUARDIAN_MODEL.
//
// Target: JyothsnaAshok/orders-service, candidate release/v1.3.0 vs base tag v1.2.0.
// Expected true state: CI green, one migration touched (0003_drop_status_column),
// no unresolved high-urgency incident (MOCK_SCENARIO=clear).
//
// Usage: node --env-file=.env scripts/smoke-readiness.mjs

import { TrueForge } from '@truefoundry/trueforge-sdk';

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
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
2. github.list_commits for owner "${owner}" repo "${repo}" on ${HEAD}; also on ${BASE}. The
   commits on ${HEAD} that are not on ${BASE} are this release's diff. Summarise in one line.
3. For each of those commits use github.get_commit to see which files changed. Any file
   under a "migrations/" directory is a migration. Collect their paths.
4. github-actions.actions_list workflow runs for ${HEAD}; read the conclusion of the most
   recent one. "success" => tests_pass true; "failure" => false; anything else or a failed
   lookup => "unknown".
5. mock-connectors.pagerduty_list_incidents — an incident with urgency "high" and status
   not "resolved" is an open incident blocking readiness. List "PD-<id>: <title>" for each.
6. guardian-actions.save_check_result, kind "readiness", result:
   { tests_pass, open_incidents: [..]|null, has_migration, migrations: [..]|null, diff_summary: string|null }
   All fields required. An array field is [] when the lookup SUCCEEDED and found nothing
   (e.g. no open incidents) — use null ONLY when the lookup itself errored, and then name
   the field in unknown_fields. Same for booleans: "unknown", not false, on a failed lookup.
7. Reply with the final JSON you saved.`;

const { data: session } = await client.sessions.create({
  agent: {
    spec: {
      model: { name: model },
      instructions,
      mcp_servers: [
        { name: 'github', enable_tools: ['@read-only'] },
        { name: 'github-actions', enable_tools: ['@read-only'] },
        { name: 'mock-connectors', enable_tools: ['@read-only'] },
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

let reply = '';
const toolCalls = [];
for await (const { data: e } of stream.withMetadata()) {
  if (e.type === 'model.message.delta') reply += e.content ?? '';
  else if (e.type === 'tool.response') toolCalls.push(e.content ?? '');
  else if (e.type === 'turn.done') console.log(`[turn.done] ${e.state.status} ${e.state.message ?? ''}`);
}

const saved = toolCalls.find((c) => c.includes('"saved"'));
console.log('\nsave_check_result response:', saved ?? '(none)');
console.log('\nagent reply:\n', reply.trim());

const blob = `${saved ?? ''}\n${reply}`;
const persisted = Boolean(saved?.includes('"saved": true'));
const testsPass = /"tests_pass":\s*true/.test(blob);
const hasMigration = /"has_migration":\s*true/.test(blob);
const foundMigrationFile = /0003_drop_status_column/.test(blob);
const pass = persisted && testsPass && hasMigration && foundMigrationFile;

console.log(
  `\n${pass ? 'PASS' : 'FAIL'} — persisted=${persisted}, tests_pass=${testsPass}, has_migration=${hasMigration}, saw 0003=${foundMigrationFile}`,
);
process.exit(pass ? 0 : 1);
