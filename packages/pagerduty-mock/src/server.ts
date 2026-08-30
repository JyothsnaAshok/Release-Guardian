import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SCENARIO, oncalls, incidents } from './fixtures.js';

/**
 * pagerduty-mock — stand-in for PagerDuty (incidents + on-call) while the real
 * OAuth connector isn't wired (PRD §18: mock behind the same MCP interface,
 * disclose in the README). All tools are read-only.
 *
 * Calendar is no longer mocked — the Freeze Check reads a real Google Calendar
 * through composio-bridge. Swap this for a real PagerDuty MCP by changing the
 * connector config; the agent and the freeze-policy skill don't change.
 */

const PORT = Number(process.env.PAGERDUTY_PORT ?? 9200);
// Loopback by default, like guardian-actions — this server is unauthenticated.
const HOST = process.env.PAGERDUTY_HOST ?? '127.0.0.1';
const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'pagerduty', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'pagerduty_list_oncalls',
    {
      title: 'List current on-call assignments',
      description: 'PagerDuty-shaped GET /oncalls — who is on call now, per escalation policy.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ok({ scenario: SCENARIO, oncalls: oncalls() }),
  );

  server.registerTool(
    'pagerduty_list_incidents',
    {
      title: 'List incidents',
      description:
        'PagerDuty-shaped GET /incidents. An unresolved high-urgency incident is an incident freeze per the freeze-policy skill.',
      inputSchema: {
        statuses: z
          .array(z.enum(['triggered', 'acknowledged', 'resolved']))
          .describe('Filter by status; omit for all')
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ statuses }) => {
      const all = incidents();
      const filtered = statuses?.length ? all.filter((i) => statuses.includes(i.status)) : all;
      return ok({ scenario: SCENARIO, incidents: filtered });
    },
  );

  return server;
}

const app = express();
app.use(express.json());
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'pagerduty-mock', scenario: SCENARIO }));

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
  console.log(`pagerduty-mock MCP on http://${HOST}:${PORT}/mcp  (scenario: ${SCENARIO})`);
});
