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
  PAGERDUTY_MCP_URL = 'http://localhost:9200/mcp',

  // GitHub connectors — the real one (demo repos live on github.com). Two servers:
  // the default toolset (repo/PR/commit reads) and the actions toolset (CI status),
  // which GitHub's remote MCP splits onto a separate endpoint.
  GITHUB_PAT,
  GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/',
  GITHUB_ACTIONS_MCP_URL = 'https://api.githubcopilot.com/mcp/x/actions/readonly',

  // Optional extra OpenAI-compatible "custom" provider (e.g. Cerebras).
  CUSTOM_PROVIDER_NAME = 'cerebras',
  CUSTOM_BASE_URL = 'https://api.cerebras.ai/v1',
  CUSTOM_API_KEY,
  CUSTOM_MODEL_NAME = 'llama-3.3-70b',
  CUSTOM_MODEL_UPSTREAM_ID = 'llama-3.3-70b',
  CUSTOM_MODEL_CONTEXT_LENGTH = '128000',
  CUSTOM_MODEL_MAX_OUTPUT = '32000',

  // composio-bridge — our local MCP wrapping the Composio SDK (real Google Calendar).
  // The Composio API key itself is read by the bridge / guardian-actions processes
  // from their own env, not sent here.
  COMPOSIO_MCP_URL = 'http://localhost:9300/mcp',
  COMPOSIO_API_KEY,

  // Skills are git-backed: registered from a repo URL + ref + path, not a local dir.
  SKILLS_REPO_URL = 'https://github.com/JyothsnaAshok/Release-Guardian',
  SKILLS_REPO_REF = 'main',
} = process.env;

const SKILLS = [
  { name: 'freeze-policy', path: 'skills/freeze-policy', description: 'Freeze rules (calendar / incident / weekend) and the freeze-check output contract.' },
  { name: 'rollback-runbook-format', path: 'skills/rollback-runbook-format', description: 'What a valid rollback runbook contains and how the rollback dry-run is judged.' },
  { name: 'comms-tone', path: 'skills/comms-tone', description: 'Tone, length, and content rules for the single stakeholder release email.' },
];

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
        // Aggressive teardown — a run's sandbox goes idle when the turn ends.
        autoStopIntervalInMinutes: Number(process.env.DAYTONA_AUTO_STOP_MIN ?? 3),
        autoArchiveIntervalInMinutes: Number(process.env.DAYTONA_AUTO_ARCHIVE_MIN ?? 15),
        autoDeleteIntervalInMinutes: Number(process.env.DAYTONA_AUTO_DELETE_MIN ?? 120),
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

await step(`mcp server "pagerduty" -> ${PAGERDUTY_MCP_URL}`, () =>
  client.settings.mcpServers.createOrUpdate({
    manifest: {
      type: 'remote',
      name: 'pagerduty',
      url: PAGERDUTY_MCP_URL,
      description: 'PagerDuty (mock) — on-call and incidents for the Freeze / Readiness checks. Calendar is real (composio).',
    },
  }),
);

if (GITHUB_PAT) {
  const ghAuth = { type: 'header', headers: { Authorization: `Bearer ${GITHUB_PAT}` } };
  await step(`mcp server "github" -> ${GITHUB_MCP_URL}`, () =>
    client.settings.mcpServers.createOrUpdate({
      manifest: {
        type: 'remote',
        name: 'github',
        url: GITHUB_MCP_URL,
        description: 'GitHub — repo diff, commits, file contents, tags/releases, PRs for the release candidate under test.',
        auth: ghAuth,
      },
    }),
  );
  await step(`mcp server "github-actions" -> ${GITHUB_ACTIONS_MCP_URL}`, () =>
    client.settings.mcpServers.createOrUpdate({
      manifest: {
        type: 'remote',
        name: 'github-actions',
        url: GITHUB_ACTIONS_MCP_URL,
        description: 'GitHub Actions (read-only) — workflow run status for a ref, job logs.',
        auth: ghAuth,
      },
    }),
  );
} else {
  console.log('  skip github (GITHUB_PAT not set)');
}

if (COMPOSIO_API_KEY) {
  await step(`mcp server "composio" -> ${COMPOSIO_MCP_URL}`, () =>
    client.settings.mcpServers.createOrUpdate({
      manifest: {
        type: 'remote',
        name: 'composio',
        url: COMPOSIO_MCP_URL,
        description: 'composio-bridge — real Google Calendar events.list for the freeze-window check.',
      },
    }),
  );
} else {
  console.log('  skip composio (COMPOSIO_API_KEY not set)');
}

for (const skill of SKILLS) {
  await step(`skill "${skill.name}" <- ${SKILLS_REPO_URL}@${SKILLS_REPO_REF}/${skill.path}`, () =>
    client.settings.skills.createOrUpdate({
      manifest: {
        type: 'git',
        name: skill.name,
        url: SKILLS_REPO_URL,
        ref: SKILLS_REPO_REF,
        path: skill.path,
        description: skill.description,
      },
    }),
  );
}

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.length} step(s) did not complete:`);
  for (const label of failures) console.error(`  - ${label}`);
  console.error('Fix the errors above and re-run before applying the agent.');
  process.exit(1);
}

console.log('\ndone. Real OAuth connectors (GitHub, PagerDuty, Google Calendar) can replace');
console.log('the mocks later via Settings -> Connectors — the agent config does not change.');
