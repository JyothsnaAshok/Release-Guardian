/**
 * Minimal migration runner for the demo service — zero dependencies.
 *
 *   node scripts/migrate.mjs up
 *   node scripts/migrate.mjs verify-rollback
 *
 * `verify-rollback` brings a fresh in-memory DB to the state the release inherits
 * (every migration except the latest, plus seed.sql), snapshots it, then applies
 * the latest up followed by the latest down and snapshots again. Exit 0 if the two
 * snapshots are identical (the latest migration reverses cleanly), 1 if they differ
 * (schema or row content was lost).
 *
 * It interprets the tiny SQL subset the migrations use (CREATE/DROP TABLE, ALTER
 * TABLE ADD/DROP COLUMN, CREATE/DROP INDEX, INSERT ... VALUES) over plain objects —
 * no SQLite, no `npm install`. Release Guardian's Rollback Check runs this in a
 * sandbox against the candidate checkout.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const [, , cmd] = process.argv;
if (cmd !== 'up' && cmd !== 'verify-rollback') {
  console.error('usage: migrate.mjs <up|verify-rollback>');
  process.exit(2);
}

function migrationIds() {
  const ids = new Set();
  for (const f of readdirSync(MIG_DIR)) {
    const m = /^(\d+)_.*_(up|down)\.sql$/.exec(f);
    if (m) ids.add(m[1]);
  }
  return [...ids].sort();
}
const sqlFor = (id, dir) => {
  const f = readdirSync(MIG_DIR).find((n) => n.startsWith(`${id}_`) && n.endsWith(`_${dir}.sql`));
  if (!f) throw new Error(`no ${dir} migration for ${id}`);
  return readFileSync(join(MIG_DIR, f), 'utf8');
};
const seedSql = () => readFileSync(join(MIG_DIR, 'seed.sql'), 'utf8');

// --- tiny SQL interpreter over { tables: { name: { columns, rows, indexes } } } ---

function stripComments(sql) {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

function statements(sql) {
  return stripComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseColumnDefs(body) {
  // split on commas that are not inside parens
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts
    .filter((p) => !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(p))
    .map((p) => {
      const name = p.split(/\s+/)[0].replace(/["'`]/g, '');
      const def = /DEFAULT\s+('[^']*'|"[^"]*"|\S+)/i.exec(p);
      return {
        name,
        notNull: /\bNOT\s+NULL\b/i.test(p),
        default: def ? unquote(def[1]) : null,
      };
    });
}

function unquote(v) {
  const t = v.trim();
  if (/^'.*'$/.test(t) || /^".*"$/.test(t)) return t.slice(1, -1);
  if (/^-?\d+$/.test(t)) return Number(t);
  return t;
}

function splitTuple(inner) {
  const out = [];
  let cur = '';
  let q = null;
  for (const ch of inner) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') q = ch;
    else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.map((x) => (/^-?\d+$/.test(x) ? Number(x) : x));
}

function exec(db, sql) {
  for (const stmt of statements(sql)) {
    let m;
    if ((m = /^CREATE TABLE\s+(\w+)\s*\(([\s\S]+)\)$/i.exec(stmt))) {
      db.tables[m[1]] = { columns: parseColumnDefs(m[2]), rows: [], indexes: [] };
    } else if ((m = /^DROP TABLE\s+(\w+)$/i.exec(stmt))) {
      delete db.tables[m[1]];
    } else if ((m = /^CREATE INDEX\s+(\w+)\s+ON\s+(\w+)/i.exec(stmt))) {
      db.tables[m[2]].indexes.push(m[1]);
    } else if ((m = /^DROP INDEX\s+(\w+)$/i.exec(stmt))) {
      for (const t of Object.values(db.tables)) t.indexes = t.indexes.filter((i) => i !== m[1]);
    } else if ((m = /^ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+([\s\S]+)$/i.exec(stmt))) {
      const [col] = parseColumnDefs(m[2]);
      const t = db.tables[m[1]];
      t.columns.push(col);
      for (const r of t.rows) r[col.name] = col.default;
    } else if ((m = /^ALTER TABLE\s+(\w+)\s+DROP COLUMN\s+(\w+)$/i.exec(stmt))) {
      const t = db.tables[m[1]];
      t.columns = t.columns.filter((c) => c.name !== m[2]);
      for (const r of t.rows) delete r[m[2]];
    } else if ((m = /^INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+)$/i.exec(stmt))) {
      const cols = m[2].split(',').map((c) => c.trim());
      const tuples = m[3].match(/\(([^)]*)\)/g) || [];
      for (const tup of tuples) {
        const vals = splitTuple(tup.slice(1, -1));
        const row = {};
        cols.forEach((c, i) => (row[c] = vals[i]));
        db.tables[m[1]].rows.push(row);
      }
    } else {
      throw new Error(`unsupported statement: ${stmt.slice(0, 60)}`);
    }
  }
}

function snapshot(db) {
  return JSON.stringify(
    Object.entries(db.tables)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, t]) => ({
        table: name,
        columns: t.columns.map((c) => c.name),
        indexes: [...t.indexes].sort(),
        rows: [...t.rows].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
      })),
  );
}

const ids = migrationIds();
const latest = ids.at(-1);
const earlier = ids.slice(0, -1);

const db = { tables: {} };
for (const id of earlier) exec(db, sqlFor(id, 'up'));
exec(db, seedSql());

if (cmd === 'up') {
  exec(db, sqlFor(latest, 'up'));
  console.log(`applied ${ids.length} migration(s) over seed`);
  process.exit(0);
}

const before = snapshot(db);
exec(db, sqlFor(latest, 'up'));
exec(db, sqlFor(latest, 'down'));
const after = snapshot(db);

if (before === after) {
  console.log(`OK: migration ${latest} reverses cleanly (schema + row content match)`);
  process.exit(0);
}
console.error(`LOSS: migration ${latest} does not reverse cleanly.`);
console.error('pre-migration :', before);
console.error('after up+down :', after);
process.exit(1);
