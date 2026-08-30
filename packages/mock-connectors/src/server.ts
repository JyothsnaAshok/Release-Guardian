import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SCENARIO, calendarEvents, oncalls, incidents } from './fixtures.js';

/**
 * mock-connectors — stand-ins for Google Calendar and PagerDuty while the real
 * OAuth connectors aren't wired (PRD §18: mock behind the same MCP interface,
 * disclose in the README). All tools are read-only.
 *
 * Swap for the real servers by changing the connector config; the agent and the
 * freeze-policy skill don't change.
 */

const PORT = Number(process.env.MOCK_PORT ?? 9200);
const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'mock-connectors', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'calendar_list_events',
    {
      title: 'List calendar events in a window',
      description:
        'Google-Calendar-shaped events.list. Freeze windows are all-day events on the "Release Freezes" calendar whose summary starts with "FREEZE:".',
      inputSchema: {
        time_min: z.string().describe('ISO-8601 lower bound').optional(),
        time_max: z.string().describe('ISO-8601 upper bound').optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ time_min, time_max }) => {
      const lo = time_min ? Date.parse(time_min) : -Infinity;
      const hi = time_max ? Date.parse(time_max) : Infinity;
      const within = (e: ReturnType<typeof calendarEvents>[number]) => {
        const s = Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00Z`);
        const en = Date.parse(e.end.dateTime ?? `${e.end.date}T00:00:00Z`);
        return en >= lo && s <= hi;
      };
      return ok({ scenario: SCENARIO, events: calendarEvents().filter(within) });
    },
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
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'mock-connectors', scenario: SCENARIO }));

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
  console.log(`mock-connectors MCP on http://localhost:${PORT}/mcp  (scenario: ${SCENARIO})`);
});
