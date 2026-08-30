// Apply agents/release-guardian.json to a running TrueForge server.
// Creates the agent if its name is free, otherwise updates the existing one.
//
// Usage:
//   node scripts/apply-agent.mjs                 # model from RELEASE_GUARDIAN_MODEL
//   node scripts/apply-agent.mjs anthropic/claude-haiku-4-5   # override the model
//   node scripts/apply-agent.mjs ./other.json    # a different manifest file

import { readFileSync } from 'node:fs';
import { TrueForge } from '@truefoundry/trueforge-sdk';

const arg = process.argv[2];
// A single argument that looks like "provider/model" (and isn't a file) is a model override.
const modelOverride = arg && /^[a-z0-9-]+\/[\w.-]+$/i.test(arg) && !arg.endsWith('.json') ? arg : undefined;
const manifestPath =
  arg && !modelOverride ? arg : new URL('../agents/release-guardian.json', import.meta.url);
const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';

const env = { ...process.env };
if (modelOverride) env.RELEASE_GUARDIAN_MODEL = modelOverride;

const raw = readFileSync(manifestPath, 'utf8').replace(/\$\{(\w+)\}/g, (_, name) => {
  const v = env[name];
  if (!v) throw new Error(`env var ${name} referenced in manifest is not set`);
  return v;
});
const { name, manifest } = JSON.parse(raw);

const client = new TrueForge({ baseUrl, timeoutInSeconds: 120 });

const { data: agents } = await client.agents.list();
const existing = agents.find((a) => a.name === name);

if (existing) {
  await client.agents.update(existing.id, { manifest });
  console.log(`updated agent "${name}" (${existing.id})  model: ${manifest.model.name}`);
} else {
  const { data: created } = await client.agents.create({ name, manifest });
  console.log(`created agent "${name}" (${created.id})  model: ${manifest.model.name}`);
}
