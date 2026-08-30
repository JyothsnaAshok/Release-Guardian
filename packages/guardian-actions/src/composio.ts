import { Composio } from '@composio/core';

/**
 * Real Gmail send for send_comms (Gate 2). Composio SDK, called by slug, no LLM.
 *
 * If COMPOSIO_API_KEY is unset there is no real delivery path. A local mock is
 * only used when GUARDIAN_ALLOW_MOCK_SEND=1 is set explicitly (offline demos);
 * otherwise sendGmail throws so send_comms surfaces an unsent/error state rather
 * than recording a fabricated delivery as "sent".
 */

const API_KEY = process.env.COMPOSIO_API_KEY;
const USER_ID = process.env.COMPOSIO_USER_ID ?? 'default';
const ALLOW_MOCK_SEND = process.env.GUARDIAN_ALLOW_MOCK_SEND === '1';

export const gmailEnabled = Boolean(API_KEY);

/** Thrown when no real Gmail path is configured and mock sending was not opted into. */
export class GmailNotConfiguredError extends Error {
  constructor() {
    super(
      'Gmail is not configured (COMPOSIO_API_KEY unset). Set it to send for real, or set GUARDIAN_ALLOW_MOCK_SEND=1 for an offline mock send.',
    );
    this.name = 'GmailNotConfiguredError';
  }
}

let client: Composio | null = null;

export interface GmailSendResult {
  mode: 'gmail' | 'mock';
  delivery_ref: string;
  raw?: unknown;
}

export async function sendGmail(to: string, subject: string, body: string): Promise<GmailSendResult> {
  if (!API_KEY) {
    if (!ALLOW_MOCK_SEND) throw new GmailNotConfiguredError();
    return { mode: 'mock', delivery_ref: `<${rid()}@release-guardian.local>` };
  }
  client ??= new Composio({ apiKey: API_KEY });
  const res = (await client.tools.execute('GMAIL_SEND_EMAIL', {
    userId: USER_ID,
    arguments: { recipient_email: to, subject, body, is_html: false },
    dangerouslySkipVersionCheck: true,
  })) as Record<string, unknown>;

  const successful = Boolean(res.successful ?? res.success ?? !res.error);
  if (!successful) {
    throw new Error(`GMAIL_SEND_EMAIL failed: ${String(res.error ?? 'unknown error')}`);
  }
  const data = (res.data ?? res) as Record<string, unknown>;
  const ref =
    (data.id as string) ?? (data.threadId as string) ?? (data.messageId as string) ?? rid();
  return { mode: 'gmail', delivery_ref: String(ref), raw: data };
}

function rid() {
  return Math.random().toString(36).slice(2, 12);
}
