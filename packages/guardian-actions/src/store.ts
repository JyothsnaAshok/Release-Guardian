import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * App-level persistence for Release Guardian (PRD §13).
 *
 * This is deliberately separate from TrueForge's own session store: scheduled
 * re-check runs (PRD §9.4) start fresh sessions and must be able to reload a
 * candidate's full history from here, keyed by candidate id rather than session id.
 */

export type CheckKind = 'freeze' | 'readiness' | 'rollback';

export interface ReleaseCandidate {
  id: string;
  ref: string;
  submitted_at: string;
  status: 'evaluating' | 'blocked' | 'approved' | 'shipped' | 'cancelled';
}

export interface CheckResult {
  candidate_id: string;
  kind: CheckKind;
  /** Structured subagent output; shape depends on kind (PRD §7). */
  result: unknown;
  /** Fields the subagent could not determine — never treated as pass (PRD §7.1). */
  unknown_fields: string[];
  recorded_at: string;
}

export interface ApprovalDecision {
  candidate_id: string;
  gate: 1 | 2;
  decision: 'approve' | 'deny' | 'override';
  actor: string;
  reason: string | null;
  decided_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS release_candidate (
  id            TEXT PRIMARY KEY,
  ref           TEXT NOT NULL,
  submitted_at  TEXT NOT NULL,
  status        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS check_result (
  candidate_id   TEXT NOT NULL REFERENCES release_candidate(id),
  kind           TEXT NOT NULL,
  result_json    TEXT NOT NULL,
  unknown_fields TEXT NOT NULL,
  recorded_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approval_decision (
  candidate_id TEXT NOT NULL REFERENCES release_candidate(id),
  gate         INTEGER NOT NULL,
  decision     TEXT NOT NULL,
  actor        TEXT NOT NULL,
  reason       TEXT,
  decided_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comms_draft (
  candidate_id TEXT NOT NULL REFERENCES release_candidate(id),
  channel      TEXT NOT NULL,
  content      TEXT NOT NULL,
  status       TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_link (
  candidate_id TEXT PRIMARY KEY REFERENCES release_candidate(id),
  schedule_id  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
`;

export class Store {
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  private now(): string {
    return new Date().toISOString();
  }

  upsertCandidate(id: string, ref: string): ReleaseCandidate {
    const existing = this.getCandidate(id);
    if (existing) return existing;
    const row: ReleaseCandidate = { id, ref, submitted_at: this.now(), status: 'evaluating' };
    this.db
      .prepare('INSERT INTO release_candidate (id, ref, submitted_at, status) VALUES (?, ?, ?, ?)')
      .run(row.id, row.ref, row.submitted_at, row.status);
    return row;
  }

  getCandidate(id: string): ReleaseCandidate | undefined {
    return this.db.prepare('SELECT * FROM release_candidate WHERE id = ?').get(id) as
      | ReleaseCandidate
      | undefined;
  }

  setStatus(id: string, status: ReleaseCandidate['status']): void {
    this.db.prepare('UPDATE release_candidate SET status = ? WHERE id = ?').run(status, id);
  }

  saveCheckResult(input: {
    candidate_id: string;
    kind: CheckKind;
    result: unknown;
    unknown_fields: string[];
  }): void {
    this.db
      .prepare(
        'INSERT INTO check_result (candidate_id, kind, result_json, unknown_fields, recorded_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        input.candidate_id,
        input.kind,
        JSON.stringify(input.result),
        JSON.stringify(input.unknown_fields),
        this.now(),
      );
  }

  listCheckResults(candidateId: string): CheckResult[] {
    const rows = this.db
      .prepare('SELECT * FROM check_result WHERE candidate_id = ? ORDER BY recorded_at ASC')
      .all(candidateId) as Array<{
      candidate_id: string;
      kind: CheckKind;
      result_json: string;
      unknown_fields: string;
      recorded_at: string;
    }>;
    return rows.map((r) => ({
      candidate_id: r.candidate_id,
      kind: r.kind,
      result: JSON.parse(r.result_json),
      unknown_fields: JSON.parse(r.unknown_fields),
      recorded_at: r.recorded_at,
    }));
  }

  recordDecision(input: {
    candidate_id: string;
    gate: 1 | 2;
    decision: ApprovalDecision['decision'];
    actor: string;
    reason?: string | null;
  }): void {
    this.db
      .prepare(
        'INSERT INTO approval_decision (candidate_id, gate, decision, actor, reason, decided_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        input.candidate_id,
        input.gate,
        input.decision,
        input.actor,
        input.reason ?? null,
        this.now(),
      );
  }

  listDecisions(candidateId: string): ApprovalDecision[] {
    return this.db
      .prepare('SELECT * FROM approval_decision WHERE candidate_id = ? ORDER BY decided_at ASC')
      .all(candidateId) as ApprovalDecision[];
  }

  saveCommsDraft(input: {
    candidate_id: string;
    channel: string;
    content: string;
    status: 'draft' | 'ready_to_send' | 'sent';
  }): void {
    this.db
      .prepare(
        'INSERT INTO comms_draft (candidate_id, channel, content, status, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(input.candidate_id, input.channel, input.content, input.status, this.now());
  }

  linkSchedule(candidateId: string, scheduleId: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO schedule_link (candidate_id, schedule_id, created_at) VALUES (?, ?, ?)',
      )
      .run(candidateId, scheduleId, this.now());
  }

  getScheduleLink(candidateId: string): string | undefined {
    const row = this.db
      .prepare('SELECT schedule_id FROM schedule_link WHERE candidate_id = ?')
      .get(candidateId) as { schedule_id: string } | undefined;
    return row?.schedule_id;
  }

  unlinkSchedule(candidateId: string): void {
    this.db.prepare('DELETE FROM schedule_link WHERE candidate_id = ?').run(candidateId);
  }

  /** Everything a fresh scheduled re-check run needs to rehydrate a candidate. */
  loadFullHistory(candidateId: string) {
    return {
      candidate: this.getCandidate(candidateId),
      checks: this.listCheckResults(candidateId),
      decisions: this.listDecisions(candidateId),
      schedule_id: this.getScheduleLink(candidateId),
    };
  }
}
