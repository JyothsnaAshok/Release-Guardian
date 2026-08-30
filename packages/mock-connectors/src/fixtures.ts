/**
 * Seeded data for the mock Calendar / PagerDuty connectors.
 *
 * Shapes mirror the real APIs closely enough that swapping in the live MCP servers
 * later is a connector-config change, not an agent change:
 *   - calendar events  ~ Google Calendar `events.list` items
 *   - oncalls          ~ PagerDuty `GET /oncalls`
 *   - incidents        ~ PagerDuty `GET /incidents`
 *
 * MOCK_SCENARIO picks which world we're in:
 *   clear    — no freeze window, no blocking incident   (release should pass the freeze check)
 *   freeze   — an active FREEZE: calendar window          (release is blocked)
 *   incident — a triggered high-urgency PagerDuty incident (release is blocked)
 */

export type Scenario = 'clear' | 'freeze' | 'incident';

export const SCENARIO: Scenario = (() => {
  const raw = (process.env.MOCK_SCENARIO ?? 'freeze').toLowerCase();
  return raw === 'clear' || raw === 'freeze' || raw === 'incident' ? raw : 'freeze';
})();

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
// Evaluated per request, not once at module load, so a long-running mock server
// keeps its seeded windows/incident ages anchored to "now" rather than startup.

export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  calendar: string;
  all_day: boolean;
}

export interface OnCall {
  escalation_policy: string;
  schedule: string;
  user: { name: string; email: string };
  start: string;
  end: string;
}

export interface Incident {
  id: string;
  title: string;
  status: 'triggered' | 'acknowledged' | 'resolved';
  urgency: 'high' | 'low';
  service: string;
  created_at: string;
  html_url: string;
}

export function calendarEvents(): CalendarEvent[] {
  const now = Date.now();
  const events: CalendarEvent[] = [
    {
      id: 'evt-standup',
      summary: 'Team standup',
      start: { dateTime: iso(now + 2 * 60 * 60 * 1000) },
      end: { dateTime: iso(now + 2.5 * 60 * 60 * 1000) },
      calendar: 'team@demo.dev',
      all_day: false,
    },
    {
      // Always present — lets a "deploy in ~8 days" demo hit a freeze without a
      // freeze being active right now.
      id: 'evt-freeze-board-week',
      summary: 'FREEZE: quarterly board meeting week — no deploys',
      start: { date: iso(now + 7 * DAY).slice(0, 10) },
      end: { date: iso(now + 10 * DAY).slice(0, 10) },
      calendar: 'Release Freezes',
      all_day: true,
    },
    {
      id: 'evt-freeze-holiday',
      summary: 'FREEZE: year-end change freeze',
      start: { date: iso(now + 90 * DAY).slice(0, 10) },
      end: { date: iso(now + 97 * DAY).slice(0, 10) },
      calendar: 'Release Freezes',
      all_day: true,
    },
  ];

  if (SCENARIO === 'freeze') {
    events.push({
      id: 'evt-freeze-active',
      summary: 'FREEZE: production incident retro — no deploys',
      start: { date: iso(now - 1 * DAY).slice(0, 10) },
      end: { date: iso(now + 2 * DAY).slice(0, 10) },
      calendar: 'Release Freezes',
      all_day: true,
    });
  }
  return events;
}

export function oncalls(): OnCall[] {
  const now = Date.now();
  return [
    {
      escalation_policy: 'Payments — Primary',
      schedule: 'Payments Primary On-Call',
      user: { name: 'Dana Ruiz', email: 'dana.ruiz@demo.dev' },
      start: iso(now - 3 * DAY),
      end: iso(now + 4 * DAY),
    },
  ];
}

export function incidents(): Incident[] {
  const now = Date.now();
  if (SCENARIO !== 'incident') {
    return [
      {
        id: 'PD-1001',
        title: 'Elevated 5xx on checkout (auto-resolved)',
        status: 'resolved',
        urgency: 'high',
        service: 'checkout-api',
        created_at: iso(now - 5 * DAY),
        html_url: 'https://demo.pagerduty.com/incidents/PD-1001',
      },
    ];
  }
  return [
    {
      id: 'PD-1042',
      title: 'Sev-2: payment webhooks delayed > 15m',
      status: 'triggered',
      urgency: 'high',
      service: 'payments-worker',
      created_at: iso(now - 90 * 60 * 1000),
      html_url: 'https://demo.pagerduty.com/incidents/PD-1042',
    },
  ];
}
