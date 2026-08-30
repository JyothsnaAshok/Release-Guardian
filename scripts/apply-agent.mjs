// Apply agents/release-guardian.json to a running TrueForge server.
// Creates the agent if its name is free, otherwise updates the existing one.
// Usage: node scripts/apply-agent.mjs [path-to-manifest.json]

import { readFileSync } from 'node:fs';
import { TrueForge } from '@truefoundry/trueforge-sdk';

const manifestPath = process.argv[2] ?? new URL('../agents/release-guardian.json', import.meta.url);
const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';

const raw = readFileSync(manifestPath, 'utf8').replace(/\$\{(\w+)\}/g, (_, name) => {
  const v = process.env[name];
  if (!v) throw new Error(`env var ${name} referenced in manifest is not set`);
  return v;
});
const { name, manifest } = JSON.parse(raw);

const client = new TrueForge({ baseUrl, timeoutInSeconds: 120 });

const { data: agents } = await client.agents.list();
const existing = agents.find((a) => a.name === name);

if (existing) {
  await client.agents.update(existing.id, { manifest });
  console.log(`updated agent "${name}" (${existing.id})`);
} else {
  const { data: created } = await client.agents.create({ name, manifest });
  console.log(`created agent "${name}" (${created.id})`);
}
