import { Composio } from '@composio/core';

/**
 * Thin wrapper over the Composio SDK so both the MCP tools here and
 * guardian-actions' send_comms hit Composio the same way.
 *
 * One API key, one default user_id (the entity the Calendar + Gmail accounts were
 * linked under in the Composio dashboard). No LLM — we call tools by slug directly.
 */

const API_KEY = process.env.COMPOSIO_API_KEY;
export const COMPOSIO_USER_ID = process.env.COMPOSIO_USER_ID ?? 'default';

let client: Composio | null = null;

export function composio(): Composio {
  if (!API_KEY) {
    throw new Error('COMPOSIO_API_KEY is not set — cannot reach Google Calendar / Gmail.');
  }
  client ??= new Composio({ apiKey: API_KEY });
  return client;
}

export interface ExecResult {
  successful: boolean;
  data: unknown;
  error: string | null;
}

export async function execTool(
  slug: string,
  args: Record<string, unknown>,
  userId: string = COMPOSIO_USER_ID,
): Promise<ExecResult> {
  const res = (await composio().tools.execute(slug, {
    userId,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  })) as Partial<ExecResult> & Record<string, unknown>;

  return {
    successful: Boolean(res.successful ?? res.success ?? !res.error),
    data: res.data ?? res,
    error: (res.error as string | null) ?? null,
  };
}
