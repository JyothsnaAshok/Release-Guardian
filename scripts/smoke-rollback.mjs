// PR4 smoke test: run the Rollback Check end to end — including the sandbox
// dry-run — against a demo repo, and assert the PERSISTED result.
//
// Prereqs: TrueForge running with a Daytona sandbox provider configured;
// guardian-actions (:9100) running/registered; github connector registered
// (GITHUB_PAT); a working model in RELEASE_GUARDIAN_MODEL.
//
// SMOKE_CASE=sql   -> orders-service release/v1.3.0 (irreversible migration)
// SMOKE_CASE=code  -> checkout-api  release/v2.1.0 (forward-incompatible state)
// Both are expected to be migration_reversible: false.
//
// Usage: SMOKE_CASE=sql node --env-file=.env scripts/smoke-rollback.mjs

import { TrueForge } from '@truefoundry/trueforge-sdk';

const CASES = {
  sql: {
    repo: 'JyothsnaAshok/orders-service',
    clone: 'https://github.com/JyothsnaAshok/orders-service.git',
    head: 'release/v1.3.0',
    base: 'v1.2.0',
    cmd: 'npm ci && node scripts/migrate.mjs verify-rollback /tmp/rb.sqlite',
  },
  code: {
    repo: 'JyothsnaAshok/checkout-api',
    clone: 'https://github.com/JyothsnaAshok/checkout-api.git',
    head: 'release/v2.1.0',
    base: 'v2.0.0',
    cmd: 'npm run verify-rollback',
  },
};

const kase = CASES[process.env.SMOKE_CASE ?? 'sql'];
if (!kase) throw new Error('SMOKE_CASE must be "sql" or "code"');

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const guardianUrl = process.env.GUARDIAN_MCP_URL ?? 'http://localhost:9100/mcp';
const model = process.env.RELEASE_GUARDIAN_MODEL ?? 'anthropic/claude-haiku-4-5';
const candidateId = `rc-rollback-smoke-${process.env.SMOKE_CASE ?? 'sql'}-${Date.now()}`;
const client = new TrueForge({ baseUrl, timeoutInSeconds: 600 });
const [owner, repo] = kase.repo.split('/');

const instructions = `You are running the Rollback Check for release candidate "${candidateId}"
(${kase.repo}, candidate ${kase.head}, last release tag ${kase.base}).

1. guardian-actions.get_release_candidate, candidate_id "${candidateId}", ref "${kase.head}".
2. prior_artifact_exists: github.list_tags for owner "${owner}" repo "${repo}" — does "${kase.base}" exist? true/false ("unknown" only if the call errored).
3. runbook_current: github.get_file_contents for "ROLLBACK.md" then "docs/rollback.md" at ref "${kase.head}". If neither exists => runbook_current false.
4. flags_default_safe: no feature-flag config in this repo => true.
5. migration_reversible — RUN IT in the sandbox:
   git clone ${kase.clone} /work && cd /work && git checkout ${kase.head}
   ${kase.cmd}
   Exit code 0 => migration_reversible true. Non-zero => false, and copy the failing
   migration / reason from stdout into failing_migration. If the sandbox steps cannot
   run at all => "unknown" and name it in unknown_fields.
6. guardian-actions.save_check_result, kind "rollback", result:
   { prior_artifact_exists, migration_reversible, failing_migration, flags_default_safe, runbook_current }.
   failing_migration is null when migration_reversible is true.
7. Reply with the JSON you saved.`;

const { data: session } = await client.sessions.create({
  agent: {
    spec: {
      model: { name: model },
      instructions,
      mcp_servers: [
        { name: 'github', enable_tools: ['@read-only'] },
        {
          name: 'guardian-actions',
          enable_tools: ['@all'],
          require_approval_for_tools: ['commit_release_decision', 'handoff_comms', 'send_comms'],
        },
      ],
      config: { sandbox: { enabled: true }, dynamic_sub_agents: { enabled: false } },
    },
  },
});

const stream = await client.sessions.createTurnStream(session.id, {
  input: [{ type: 'user.message', content: 'Run the rollback check.' }],
});
for await (const { data: e } of stream.withMetadata()) {
  if (e.type === 'turn.done') console.log(`[turn.done] ${e.state.status} ${e.state.message ?? ''}`);
}

async function callGuardian(name, args) {
  const res = await fetch(guardianUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: ')) ?? text;
  return JSON.parse(JSON.parse(line.replace(/^data: /, '')).result.content[0].text);
}

const history = await callGuardian('get_release_candidate', { candidate_id: candidateId, ref: kase.head });
const rollback = [...(history.checks ?? [])].reverse().find((c) => c.kind === 'rollback');
console.log('\npersisted rollback result:', JSON.stringify(rollback, null, 2));

const r = rollback?.result ?? {};
const checks = {
  persisted: Boolean(rollback),
  not_reversible: r.migration_reversible === false,
  named_failure: typeof r.failing_migration === 'string' && r.failing_migration.length > 0,
  prior_artifact: r.prior_artifact_exists === true,
};
const pass = Object.values(checks).every(Boolean);
console.log(`\n${pass ? 'PASS' : 'FAIL'} — case "${process.env.SMOKE_CASE ?? 'sql'}"`, checks);
process.exit(pass ? 0 : 1);
