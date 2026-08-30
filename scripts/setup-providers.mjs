// Configure a running TrueForge server from environment variables:
//   - one model provider (Anthropic or OpenAI) with its API key
//   - the Daytona sandbox provider
//   - the guardian-actions MCP server
//
// Idempotent: uses createOrUpdate throughout, so it is safe to re-run.
// The SDK input types are camelCase (apiKey, baseUrl, modelId, ...); it serializes
// to snake_case on the wire.
//
// Usage: node scripts/setup-providers.mjs

import { TrueForge } from '@truefoundry/trueforge-sdk';

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const client = new TrueForge({ baseUrl, timeoutInSeconds: 180 });

const {
  MODEL_PROVIDER = 'anthropic', // 'anthropic' | 'openai'
  MODEL_API_KEY,
  MODEL_NAME = 'claude-sonnet-4-6', // the short name you'll reference as <provider>/<name>
  MODEL_UPSTREAM_ID = 'claude-sonnet-4-6', // the id actually sent to the provider API
  MODEL_CONTEXT_LENGTH = '200000',
  MODEL_MAX_OUTPUT = '64000',
  DAYTONA_API_KEY,
  GUARDIAN_MCP_URL = 'http://localhost:9100/mcp',

  // Optional extra OpenAI-compatible "custom" provider (e.g. Cerebras).
  CUSTOM_PROVIDER_NAME = 'cerebras',
  CUSTOM_BASE_URL = 'https://api.cerebras.ai/v1',
  CUSTOM_API_KEY,
  CUSTOM_MODEL_NAME = 'llama-3.3-70b',
  CUSTOM_MODEL_UPSTREAM_ID = 'llama-3.3-70b',
  CUSTOM_MODEL_CONTEXT_LENGTH = '128000',
  CUSTOM_MODEL_MAX_OUTPUT = '32000',
} = process.env;

const failures = [];

async function step(label, fn) {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    const status = err?.statusCode ?? err?.status;
    if (status === 409) {
      console.log(`  skip ${label} (already exists)`);
    } else {
      console.log(`  FAIL ${label}: ${err?.message ?? err}`);
      failures.push(label);
    }
  }
}

console.log(`configuring ${baseUrl}`);

if (MODEL_API_KEY) {
  await step(`model provider "${MODEL_PROVIDER}" with model "${MODEL_NAME}"`, () =>
    client.settings.modelProviders.createOrUpdate({
      manifest: {
        type: MODEL_PROVIDER,
        auth: { apiKey: MODEL_API_KEY },
        models: [
          {
            name: MODEL_NAME,
            modelId: MODEL_UPSTREAM_ID,
            properties: {
              contextLength: Number(MODEL_CONTEXT_LENGTH),
              maxOutputTokens: Number(MODEL_MAX_OUTPUT),
            },
          },
        ],
      },
    }),
  );
  console.log(`       -> reference this model as "${MODEL_PROVIDER}/${MODEL_NAME}" (set RELEASE_GUARDIAN_MODEL)`);
} else {
  console.log('  skip model provider (MODEL_API_KEY not set)');
}

if (CUSTOM_API_KEY) {
  await step(
    `custom provider "${CUSTOM_PROVIDER_NAME}" (${CUSTOM_BASE_URL}) with model "${CUSTOM_MODEL_NAME}"`,
    () =>
      client.settings.modelProviders.createOrUpdate({
        manifest: {
          type: 'custom',
          name: CUSTOM_PROVIDER_NAME,
          baseUrl: CUSTOM_BASE_URL,
          auth: { apiKey: CUSTOM_API_KEY },
          models: [
            {
              name: CUSTOM_MODEL_NAME,
              modelId: CUSTOM_MODEL_UPSTREAM_ID,
              properties: {
                contextLength: Number(CUSTOM_MODEL_CONTEXT_LENGTH),
                maxOutputTokens: Number(CUSTOM_MODEL_MAX_OUTPUT),
              },
            },
          ],
        },
      }),
  );
  console.log(`       -> reference this model as "${CUSTOM_PROVIDER_NAME}/${CUSTOM_MODEL_NAME}"`);
} else {
  console.log('  skip custom provider (CUSTOM_API_KEY not set)');
}

if (DAYTONA_API_KEY) {
  await step('daytona sandbox provider', () =>
    client.settings.sandboxProviders.createOrUpdate({
      manifest: {
        type: 'daytona',
        auth: { apiKey: DAYTONA_API_KEY },
        execTimeoutMs: 120000,
        autoStopIntervalInMinutes: 15,
        autoArchiveIntervalInMinutes: 10080,
        autoDeleteIntervalInMinutes: 43200,
      },
    }),
  );
} else {
  console.log('  skip daytona (DAYTONA_API_KEY not set)');
}

await step(`mcp server "guardian-actions" -> ${GUARDIAN_MCP_URL}`, () =>
  client.settings.mcpServers.createOrUpdate({
    manifest: {
      type: 'remote',
      name: 'guardian-actions',
      url: GUARDIAN_MCP_URL,
      description: 'Release Guardian first-party actions: approval gates, app store, evidence pack, schedule management.',
    },
  }),
);

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.length} step(s) did not complete:`);
  for (const label of failures) console.error(`  - ${label}`);
  console.error('Fix the errors above and re-run before applying the agent.');
  process.exit(1);
}

console.log('\ndone. OAuth connectors (GitHub, PagerDuty, Google Calendar) must still be');
console.log('added in Settings -> Connectors — they need an interactive auth flow.');
