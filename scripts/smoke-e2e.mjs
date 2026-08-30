// PR4 end-to-end smoke: drive the REAL applied `release-guardian` agent through a
// full run against orders-service release/v1.3.0 and assert the pipeline —
// 3 checks -> Code Mode aggregation -> Gate 1 pause -> approve -> no_go handling.
//
// Prereqs: everything from setup-providers + apply-agent, with the skills pointed
// at a ref that has PR4's rollback-runbook-format (SKILLS_REPO_REF).
//
// Usage: node --env-file=.env scripts/smoke-e2e.mjs

import { TrueForge } from '@truefoundry/trueforge-sdk';

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const guardianUrl = process.env.GUARDIAN_MCP_URL ?? 'http://localhost:9100/mcp';
const client = new TrueForge({ baseUrl, timeoutInSeconds: 900 });
const candidateId = `rc-e2e-${Date.now()}`;

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

const { data: session } = await client.sessions.create({ agent: { name: 'release-guardian' } });

const msg = `Evaluate release candidate "${candidateId}": GitHub repo JyothsnaAshok/orders-service, candidate branch release/v1.3.0, last release tag v1.2.0. The incident tracker and calendar are the mock-connectors server.`;

let pausedAtGate1 = false;
let pending = null; // { threadId, toolCallId }

async function runTurn(input) {
  const stream = await client.sessions.createTurnStream(session.id, { input });
  for await (const { data: e } of stream.withMetadata()) {
    if (e.type === 'tool.approval_required') {
      pending = { threadId: e.threadId, toolCallId: e.toolCalls?.[0]?.id };
      console.log('[approval required]', JSON.stringify(e).slice(0, 220));
    } else if (e.type === 'turn.done') {
      console.log(`[turn.done] ${e.state.status} ${e.state.message ?? ''}`);
      return e.state;
    }
  }
}

console.log('--- turn 1: submit candidate ---');
const s1 = await runTurn([{ type: 'user.message', content: msg }]);

// The agent should be paused before commit_release_decision (Gate 1).
const hist1 = await callGuardian('get_release_candidate', { candidate_id: candidateId, ref: 'release/v1.3.0' });
const kinds = new Set((hist1.checks ?? []).map((c) => c.kind));
const score = hist1.risk_scores?.at(-1)?.score;
console.log('\nchecks persisted:', [...kinds].sort().join(', '));
console.log('risk score:', JSON.stringify(score));
console.log('paused for approval:', Boolean(pending));
pausedAtGate1 = Boolean(pending);

// Approve Gate 1.
let gate2Fired = false;
if (pending) {
  const g1 = pending;
  pending = null;
  console.log('\n--- turn 2: approve Gate 1 ---');
  await runTurn([
    { type: 'user.tool_approval', threadId: g1.threadId, toolCallId: g1.toolCallId, approval: { status: 'allow' } },
  ]);
  gate2Fired = Boolean(pending); // agent proceeded to draft comms and hit Gate 2
}

const hist2 = await callGuardian('get_release_candidate', { candidate_id: candidateId, ref: 'release/v1.3.0' });
const decision = hist2.release_decisions?.at(-1);
const rollbackCheck = (hist2.checks ?? []).reverse().find((c) => c.kind === 'rollback')?.result ?? {};
console.log('\nrelease decision:', JSON.stringify(decision));
console.log('rollback check:', JSON.stringify(rollbackCheck));

const checks = {
  all_three_checks: ['freeze', 'readiness', 'rollback'].every((k) => kinds.has(k)),
  score_computed: Boolean(score) && ['go', 'conditional_go', 'no_go'].includes(score?.decision),
  rollback_ran_sandbox:
    typeof rollbackCheck.dry_run_output === 'string' && rollbackCheck.dry_run_output.length > 0,
  rollback_caught_irreversible: rollbackCheck.migration_reversible === false,
  score_is_no_go: score?.decision === 'no_go',
  gate1_paused: pausedAtGate1,
  decision_matches_score: Boolean(decision) && decision?.decision === score?.decision,
};
const pass = Object.values(checks).every(Boolean);
console.log(`\n${pass ? 'PASS' : 'FAIL'} —`, checks);
process.exit(pass ? 0 : 1);
