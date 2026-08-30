import { Composio } from '@composio/core';

/**
 * Real Gmail send for send_comms (Gate 2). Composio SDK, called by slug, no LLM.
 *
 * If COMPOSIO_API_KEY is unset the send falls back to the local mock so the demo
 * still works offline — send_comms reports which path it took.
 */

const API_KEY = process.env.COMPOSIO_API_KEY;
const USER_ID = process.env.COMPOSIO_USER_ID ?? 'default';

export const gmailEnabled = Boolean(API_KEY);

let client: Composio | null = null;

export interface GmailSendResult {
  mode: 'gmail' | 'mock';
  delivery_ref: string;
  raw?: unknown;
}

export async function sendGmail(to: string, subject: string, body: string): Promise<GmailSendResult> {
  if (!API_KEY) {
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
