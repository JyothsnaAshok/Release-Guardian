import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Store } from './store.js';

/**
 * guardian-actions — the first-party MCP server for Release Guardian (PRD §9.6).
 *
 * Hosts the two approval gates plus the app-level side effects that TrueForge's
 * generic primitives don't cover. Gate tools carry `destructiveHint: true` so
 * TrueForge's `@destructive` selector resolves them into `require_approval_for_tools`.
 *
 * Status: PR1 skeleton. `commit_release_decision`, `handoff_comms`, `send_comms`,
 * `render_evidence_pack`, and schedule management are stubs that persist what they
 * can and return a shaped response; wiring lands in PR6-PR8 and the stretch PRs.
 */

const PORT = Number(process.env.GUARDIAN_PORT ?? 9100);
const DB_PATH = process.env.GUARDIAN_DB_PATH ?? './data/guardian.sqlite';
const store = new Store(DB_PATH);

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'guardian-actions', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'get_release_candidate',
    {
      title: 'Get release candidate',
      description:
        'Load a release candidate and its full prior check + approval history. Call this first on every run, including scheduled re-checks.',
      inputSchema: {
        candidate_id: z.string().describe('Stable candidate id, e.g. "rc-1234"'),
        ref: z
          .string()
          .optional()
          .describe('Branch/tag/PR ref. Required the first time a candidate is seen.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ candidate_id, ref }) => {
      if (!store.getCandidate(candidate_id)) {
        if (!ref) return ok({ error: 'unknown candidate; pass `ref` to create it' });
        store.upsertCandidate(candidate_id, ref);
      }
      return ok(store.loadFullHistory(candidate_id));
    },
  );

  server.registerTool(
    'save_check_result',
    {
      title: 'Save a subagent check result',
      description:
        'Persist a Freeze / Readiness / Rollback structured result. `unknown_fields` lists anything the check could not determine — the caller must never treat those as passing (PRD §7.1). Not human-gated by design.',
      inputSchema: {
        candidate_id: z.string(),
        kind: z.enum(['freeze', 'readiness', 'rollback']),
        result: z.record(z.string(), z.unknown()).describe('Structured result object for this kind'),
        unknown_fields: z.array(z.string()).default([]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ candidate_id, kind, result, unknown_fields }) => {
      store.saveCheckResult({ candidate_id, kind, result, unknown_fields });
      return ok({ saved: true, kind, unknown_fields });
    },
  );

  server.registerTool(
    'commit_release_decision',
    {
      title: 'Commit the go / no-go decision (GATE 1)',
      description:
        'Records the release go/no-go decision. This is the first irreversible checkpoint — the agent must render the decision card and only then call this. Human approval is required before it runs.',
      inputSchema: {
        candidate_id: z.string(),
        decision: z.enum(['go', 'no_go', 'conditional_go']),
        risk_score: z.record(z.string(), z.unknown()).describe('The computed RiskScore object'),
        reason: z.string().describe('One-line rationale, shown on the card and stored'),
        actor: z.string().default('trueforge-default'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ candidate_id, decision, reason, actor }) => {
      store.recordDecision({ candidate_id, gate: 1, decision: 'approve', actor, reason });
      store.setStatus(candidate_id, decision === 'no_go' ? 'blocked' : 'approved');
      // PR6: emit a structured decision record the custom UI can render.
      return ok({ committed: true, decision, next: decision === 'no_go' ? 'schedule_recheck' : 'draft_comms' });
    },
  );

  server.registerTool(
    'handoff_comms',
    {
      title: 'Hand off release comms for sending (GATE 2, baseline)',
      description:
        'Marks the drafted comms ready-to-send (opens mail client / posts to a review channel). Second irreversible checkpoint — an org-wide message cannot be unsent. Human approval required.',
      inputSchema: {
        candidate_id: z.string(),
        channel: z.enum(['slack', 'email']),
        content: z.string().describe('Final drafted message, post-edit'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ candidate_id, channel, content }) => {
      store.saveCommsDraft({ candidate_id, channel, content, status: 'ready_to_send' });
      store.recordDecision({ candidate_id, gate: 2, decision: 'approve', actor: 'trueforge-default', reason: null });
      return ok({ handed_off: true, channel, mode: 'manual_dispatch' });
    },
  );

  server.registerTool(
    'send_comms',
    {
      title: 'Send release comms live (GATE 2, stretch §9.5)',
      description:
        'Live send via a real mail/Slack MCP. Only available if the §9.5 stretch lands; otherwise use handoff_comms. Human approval required.',
      inputSchema: {
        candidate_id: z.string(),
        channel: z.enum(['slack', 'email']),
        content: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async () => ok({ error: 'live send not wired in this build; use handoff_comms' }),
  );

  server.registerTool(
    'render_evidence_pack',
    {
      title: 'Render the evidence pack (PRD §9.2)',
      description:
        'Generate a single audit document for a completed run from the session events API + this store: what was checked, what each subagent found, the aggregated score, who approved what and when.',
      inputSchema: {
        candidate_id: z.string(),
        session_id: z.string().describe('TrueForge session id to pull the event history from'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ candidate_id }) => {
      // Stretch PR: fetch session events via the SDK and render markdown/PDF.
      return ok({ ...store.loadFullHistory(candidate_id), rendered: false, note: 'stub' });
    },
  );

  server.registerTool(
    'schedule_recheck',
    {
      title: 'Schedule a nightly re-check for a blocked candidate',
      description:
        'Creates a TrueForge Schedule bound to this candidate. Each trigger is a fresh session seeded with "Re-evaluate blocked release candidate <id>". Min interval 3600s. Not gated.',
      inputSchema: {
        candidate_id: z.string(),
        cron: z.string().default('0 6 * * *').describe('5-field cron, evaluated in `timezone`'),
        timezone: z.string().default('UTC'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ candidate_id, cron, timezone }) => {
      // PR8: call client.schedules.create(...) and store the returned id.
      const fakeId = `sched-stub-${candidate_id}`;
      store.linkSchedule(candidate_id, fakeId);
      return ok({ scheduled: true, schedule_id: fakeId, cron, timezone, stub: true });
    },
  );

  server.registerTool(
    'cancel_recheck',
    {
      title: 'Cancel a candidate’s nightly re-check',
      description: 'Deletes the Schedule bound to this candidate once it ships or is cancelled.',
      inputSchema: { candidate_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ candidate_id }) => {
      const id = store.getScheduleLink(candidate_id);
      store.unlinkSchedule(candidate_id);
      return ok({ cancelled: Boolean(id), schedule_id: id ?? null });
    },
  );

  return server;
}

const app = express();
app.use(express.json());

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'guardian-actions' }));

// Stateless Streamable HTTP: a fresh server + transport per request.
app.post('/mcp', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`guardian-actions MCP listening on http://localhost:${PORT}/mcp  (db: ${DB_PATH})`);
});
