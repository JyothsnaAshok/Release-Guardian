/**
 * Seeded data for the mock PagerDuty connector.
 *
 * Shapes mirror the real API closely enough that swapping in a live PagerDuty MCP
 * server later is a connector-config change, not an agent change:
 *   - oncalls    ~ PagerDuty `GET /oncalls`
 *   - incidents  ~ PagerDuty `GET /incidents`
 *
 * The calendar half is no longer here — the Freeze Check reads a real Google
 * Calendar via the composio-bridge server.
 *
 * PAGERDUTY_SCENARIO picks which world we're in:
 *   clear    — one auto-resolved incident (release passes the incident check)
 *   incident — a triggered high-urgency incident (release is blocked)
 */

export type Scenario = 'clear' | 'incident';

export const SCENARIO: Scenario = (() => {
  const raw = (process.env.PAGERDUTY_SCENARIO ?? 'clear').toLowerCase();
  return raw === 'incident' ? 'incident' : 'clear';
})();

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
// Evaluated per request, not once at module load, so a long-running mock server
// keeps its seeded incident ages anchored to "now" rather than startup.

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
