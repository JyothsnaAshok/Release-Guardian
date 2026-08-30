// PR2 smoke test: run the Freeze Check end to end against the mock connectors and
// assert it (a) detects the seeded freeze and (b) persists a schema-valid result.
//
// Prereqs: TrueForge running, guardian-actions (:9100) and mock-connectors (:9200)
// running and registered (npm run setup:providers), a working model in MODEL env.
//
// The freeze-policy rules are inlined here rather than loaded as a registered skill,
// so the test doesn't depend on Settings -> Skills. The real agent uses the skill.
//
// Usage: MOCK_SCENARIO=freeze node --env-file=.env scripts/smoke-freeze.mjs

import { TrueForge } from '@truefoundry/trueforge-sdk';

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const model = process.env.RELEASE_GUARDIAN_MODEL ?? 'google-gemini/gemini-3-6-flash';
const candidateId = `rc-freeze-smoke-${Date.now()}`;
const client = new TrueForge({ baseUrl, timeoutInSeconds: 300 });

const instructions = `You are running the Freeze Check for release candidate "${candidateId}".

Steps, in order:
1. Call guardian-actions.get_release_candidate with candidate_id "${candidateId}" and ref "main".
2. Call mock-connectors.calendar_list_events with time_min = now, time_max = now + 2h.
3. Call mock-connectors.pagerduty_list_incidents.
4. Call mock-connectors.pagerduty_list_oncalls.
5. Decide in_freeze:
   - true if an all-day event on the "Release Freezes" calendar whose summary starts with
     "FREEZE:" overlaps the next 60 minutes, OR any incident has urgency "high" and status
     not "resolved".
   - false otherwise.
   - "unknown" for a field only if its lookup errored — never false on error.
6. Call guardian-actions.save_check_result with kind "freeze" and result:
   { in_freeze, reasons: [..], window: {start,end}|null, conflicting_deploys: [], oncall: {name,email}|null }
   Put any field you could not determine in unknown_fields.
7. Reply with the final JSON you saved.`;

const { data: session } = await client.sessions.create({
  agent: {
    spec: {
      model: { name: model },
      instructions,
      mcp_servers: [
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
  input: [{ type: 'user.message', content: 'Run the freeze check.' }],
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

const scenario = (process.env.MOCK_SCENARIO ?? 'freeze').toLowerCase();
const expectFreeze = scenario === 'freeze' || scenario === 'incident';
const persisted = Boolean(saved?.includes('"saved": true'));
const gotFreeze = Boolean(saved?.includes('"in_freeze": true')) || reply.includes('"in_freeze": true');
const pass = persisted && gotFreeze === expectFreeze;

console.log(
  `\n${pass ? 'PASS' : 'FAIL'} — scenario "${scenario}": persisted=${persisted}, in_freeze=${gotFreeze}, expected=${expectFreeze}`,
);
process.exit(pass ? 0 : 1);
