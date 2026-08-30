import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { execTool, COMPOSIO_USER_ID } from './composio.js';

/**
 * composio-bridge — real Google Calendar (and, via guardian-actions, real Gmail)
 * through the Composio SDK, exposed on the same local MCP interface the mock used.
 *
 * Only the freeze-check read lives here. `calendar_list_events` keeps the exact
 * name and shape the old mock calendar tool had, so the freeze-policy skill only
 * changes which server it names.
 */

const PORT = Number(process.env.COMPOSIO_BRIDGE_PORT ?? 9300);
const HOST = process.env.COMPOSIO_BRIDGE_HOST ?? '127.0.0.1';
const CALENDAR_ID = process.env.COMPOSIO_CALENDAR_ID ?? 'primary';

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
  isError: true as const,
});

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'composio-bridge', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'calendar_list_events',
    {
      title: 'List calendar events in a window (real Google Calendar via Composio)',
      description:
        'Google Calendar events.list for the window [time_min, time_max], all pages followed. Freeze windows are events whose summary starts with "FREEZE:". Returns a top-level events[] array (read events[].summary / start / end); `result` is the last raw page. Returns an error if the window is too large to page fully.',
      inputSchema: {
        time_min: z.string().describe('ISO-8601 lower bound').optional(),
        time_max: z.string().describe('ISO-8601 upper bound').optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ time_min, time_max }) => {
      try {
        // GOOGLECALENDAR_EVENTS_LIST mirrors the Google Calendar events.list query
        // params, which are camelCase. Follow nextPageToken to completion so a
        // FREEZE: event past the first page in a busy window is never dropped.
        const PAGE_SIZE = 250;
        const MAX_PAGES = 40; // hard ceiling so a pathological calendar can't loop forever
        const events: unknown[] = [];
        let pageToken: string | undefined;
        let pages = 0;
        let last: unknown;

        do {
          const res = await execTool('GOOGLECALENDAR_EVENTS_LIST', {
            calendarId: CALENDAR_ID,
            timeMin: time_min,
            timeMax: time_max,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: PAGE_SIZE,
            ...(pageToken ? { pageToken } : {}),
          });
          if (!res.successful) return fail(res.error ?? 'calendar lookup failed');

          const data = (res.data ?? {}) as Record<string, unknown>;
          const items = (data.items ?? data.events ?? []) as unknown[];
          if (Array.isArray(items)) events.push(...items);
          last = res.data;
          pageToken = (data.nextPageToken ?? data.next_page_token) as string | undefined;
          pages += 1;
        } while (pageToken && pages < MAX_PAGES);

        if (pageToken) {
          // Still more pages than our ceiling — report incomplete rather than
          // letting the freeze check silently pass on a partial window.
          return fail(
            `calendar window has more than ${PAGE_SIZE * MAX_PAGES} events; result is incomplete — narrow the window`,
          );
        }

        return ok({
          source: 'google-calendar',
          user_id: COMPOSIO_USER_ID,
          pages,
          event_count: events.length,
          events,
          result: last,
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  return server;
}

const app = express();
app.use(express.json());
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'composio-bridge' }));

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
  console.log(`composio-bridge MCP on http://${HOST}:${PORT}/mcp  (user_id: ${COMPOSIO_USER_ID})`);
});
