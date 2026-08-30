import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Store, UnknownCandidateError } from './store.js';
import { CHECK_SCHEMAS, HEADLINE_FIELD, EVIDENCE_FIELDS } from './schemas.js';

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
// Local-only by default: these tools mutate approval / comms state and the endpoint
// is unauthenticated, so it must not be reachable off-host. Override only behind an
// authenticating proxy.
const HOST = process.env.GUARDIAN_HOST ?? '127.0.0.1';
const DB_PATH = process.env.GUARDIAN_DB_PATH ?? './data/guardian.sqlite';
const store = new Store(DB_PATH);

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
  isError: true as const,
});

/** Run a mutating handler, turning an unknown-candidate write into a shaped MCP error. */
async function guarded(fn: () => unknown) {
  try {
    return fn() as ReturnType<typeof ok>;
  } catch (err) {
    if (err instanceof UnknownCandidateError) return fail(err.message);
    throw err;
  }
}

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
        target_deploy_at: z
          .string()
          .nullable()
          .optional()
          .describe(
            'ISO-8601 planned deploy instant, or null for "ship now". The Freeze Check evaluates the calendar for this window. Set on first creation.',
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ candidate_id, ref, target_deploy_at }) => {
      if (!store.getCandidate(candidate_id)) {
        if (!ref) return ok({ error: 'unknown candidate; pass `ref` to create it' });
        store.upsertCandidate(candidate_id, ref, target_deploy_at ?? null);
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
      const parsed = CHECK_SCHEMAS[kind].safeParse(result);
      if (!parsed.success) {
        return ok({
          saved: false,
          error: `result does not match the ${kind} schema — fix and retry`,
          issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
        });
      }
      const headline = HEADLINE_FIELD[kind];
      const value = (parsed.data as Record<string, unknown>)[headline];
      if (value === undefined) {
        return ok({ saved: false, error: `"${headline}" is required (use "unknown" if a lookup failed)` });
      }
      // A failed lookup can never read as determined, whether or not the caller
      // remembered to list it: a "unknown" tri-state value, or a null evidence
      // field (array-or-null, where null means the list lookup failed), is
      // declared unknown here regardless.
      const data = parsed.data as Record<string, unknown>;
      const fieldNames = Object.keys(data);
      const strayNames = unknown_fields.filter((f) => !fieldNames.includes(f));
      if (strayNames.length > 0) {
        return ok({
          saved: false,
          error: `unknown_fields may only name actual ${kind} result fields; not: ${strayNames.join(', ')}`,
        });
      }
      // The Rollback Check's reversibility verdict is only valid with the
      // execution evidence behind it — a boolean migration_reversible must carry
      // the verify-rollback output, so the subagent cannot assert a value it
      // never ran (PRD §7.1 / G2).
      if (
        kind === 'rollback' &&
        typeof data.migration_reversible === 'boolean' &&
        (data.dry_run_output == null || String(data.dry_run_output).trim() === '')
      ) {
        return ok({
          saved: false,
          error:
            'migration_reversible is a boolean but dry_run_output is empty — include the verbatim verify-rollback output, or set migration_reversible to "unknown" if the dry-run could not run',
        });
      }

      const unknownValued = Object.entries(data)
        .filter(([, v]) => v === 'unknown')
        .map(([k]) => k);
      const nullEvidence = EVIDENCE_FIELDS[kind].filter((k) => data[k] === null);
      const declaredUnknown = [...new Set([...unknown_fields, ...unknownValued, ...nullEvidence])];
      return guarded(() => {
        store.saveCheckResult({ candidate_id, kind, result: parsed.data, unknown_fields: declaredUnknown });
        // Echo the validated, stored result so callers assert against what was
        // persisted rather than the model's prose.
        return ok({ saved: true, kind, result: parsed.data, unknown_fields: declaredUnknown });
      });
    },
  );

  server.registerTool(
    'save_risk_score',
    {
      title: 'Save the computed RiskScore (Code Mode aggregation output)',
      description:
        'Persist the aggregated RiskScore produced by the Code Mode step, BEFORE rendering the decision card and calling commit_release_decision. Not human-gated — computing a score is not an irreversible action.',
      inputSchema: {
        candidate_id: z.string(),
        score: z
          .object({
            decision: z.enum(['go', 'conditional_go', 'no_go']),
            blockers: z.array(z.string()),
            concerns: z.array(z.string()),
            unknowns: z.array(z.string()),
            summary: z.string(),
          })
          .strict(),
        computed_by: z.string().describe('Model FQN(s) that computed this score'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ candidate_id, score, computed_by }) =>
      guarded(() => {
        store.saveRiskScore({ candidate_id, score, computed_by });
        return ok({ saved: true, score });
      }),
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
    async ({ candidate_id, decision, risk_score, reason, actor }) =>
      guarded(() => {
        // Two distinct records: the gate approval audit, and the release decision itself
        // (exact go / conditional_go / no_go + the computed score) so a scheduled re-check
        // or evidence pack can reconstruct it from loadFullHistory.
        store.recordReleaseDecision({ candidate_id, decision, risk_score, reason, actor });
        store.recordDecision({ candidate_id, gate: 1, decision: 'approve', actor, reason });
        store.setStatus(candidate_id, decision === 'no_go' ? 'blocked' : 'approved');
        // PR6: emit a structured decision record the custom UI can render.
        return ok({
          committed: true,
          decision,
          next: decision === 'no_go' ? 'schedule_recheck' : 'draft_comms',
        });
      }),
  );

  server.registerTool(
    'handoff_comms',
    {
      title: 'Hand off release comms for sending (GATE 2, baseline)',
      description:
        'Marks BOTH drafted messages (Slack summary + stakeholder email) ready-to-send in one step. Second irreversible checkpoint — an org-wide message cannot be unsent — so both drafts transition under a single human approval.',
      inputSchema: {
        candidate_id: z.string(),
        slack: z.string().describe('Final Slack summary, post-edit'),
        email: z.string().describe('Final stakeholder email, post-edit'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ candidate_id, slack, email }) =>
      guarded(() => {
        store.saveCommsDrafts({
          candidate_id,
          status: 'ready_to_send',
          drafts: [
            { channel: 'slack', content: slack },
            { channel: 'email', content: email },
          ],
        });
        store.recordDecision({
          candidate_id,
          gate: 2,
          decision: 'approve',
          actor: 'trueforge-default',
          reason: null,
        });
        return ok({ handed_off: true, channels: ['slack', 'email'], mode: 'manual_dispatch' });
      }),
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
    async ({ candidate_id, cron, timezone }) =>
      guarded(() => {
        // PR8: call client.schedules.create(...) and store the returned id.
        const fakeId = `sched-stub-${candidate_id}`;
        store.linkSchedule(candidate_id, fakeId);
        return ok({ scheduled: true, schedule_id: fakeId, cron, timezone, stub: true });
      }),
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

app.listen(PORT, HOST, () => {
  console.log(`guardian-actions MCP listening on http://${HOST}:${PORT}/mcp  (db: ${DB_PATH})`);
});
