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

/** `mock_sent` records an offline mock dispatch — deliberately distinct from a real `sent`. */
export type CommsDraftStatus = 'draft' | 'ready_to_send' | 'sent' | 'mock_sent';

export interface ReleaseCandidate {
  id: string;
  ref: string;
  submitted_at: string;
  /** ISO-8601 planned deploy instant. `null` means "ship now" — the Freeze Check
   *  then evaluates the calendar for the current window instead of a future one. */
  target_deploy_at: string | null;
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

/** The actual go / no-go outcome committed at Gate 1 — distinct from the gate approval audit row. */
export interface ReleaseDecision {
  candidate_id: string;
  decision: 'go' | 'no_go' | 'conditional_go';
  /** The computed RiskScore object, as produced by the Code Mode aggregation step. */
  risk_score: unknown;
  reason: string;
  actor: string;
  decided_at: string;
}

/** Thrown when a mutation references a candidate id that does not exist. */
export class UnknownCandidateError extends Error {
  constructor(public candidateId: string) {
    super(`unknown release candidate: ${candidateId}`);
    this.name = 'UnknownCandidateError';
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS release_candidate (
  id               TEXT PRIMARY KEY,
  ref              TEXT NOT NULL,
  submitted_at     TEXT NOT NULL,
  target_deploy_at TEXT,
  status           TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS release_decision (
  candidate_id    TEXT NOT NULL REFERENCES release_candidate(id),
  decision        TEXT NOT NULL,
  risk_score_json TEXT NOT NULL,
  reason          TEXT NOT NULL,
  actor           TEXT NOT NULL,
  decided_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_score (
  candidate_id TEXT NOT NULL REFERENCES release_candidate(id),
  score_json   TEXT NOT NULL,
  computed_by  TEXT NOT NULL,
  computed_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comms_draft (
  candidate_id TEXT NOT NULL REFERENCES release_candidate(id),
  channel      TEXT NOT NULL,
  content      TEXT NOT NULL,
  status       TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comms_delivery (
  candidate_id TEXT NOT NULL REFERENCES release_candidate(id),
  channel      TEXT NOT NULL,
  target       TEXT NOT NULL,
  delivery_ref TEXT NOT NULL,
  sent_at      TEXT NOT NULL
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
    // SQLite ignores REFERENCES clauses unless this is enabled per-connection.
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * Idempotent column adds for databases created by an earlier revision.
   * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a column
   * added to SCHEMA after a DB was first created is missing until we add it here.
   */
  private migrate(): void {
    const ensureColumn = (table: string, column: string, decl: string) => {
      const cols = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      }
    };
    ensureColumn('release_candidate', 'target_deploy_at', 'TEXT');
  }

  private now(): string {
    return new Date().toISOString();
  }

  /** Throw if the candidate does not exist, so callers get a shaped error instead of an orphan row. */
  requireCandidate(id: string): ReleaseCandidate {
    const existing = this.getCandidate(id);
    if (!existing) throw new UnknownCandidateError(id);
    return existing;
  }

  upsertCandidate(id: string, ref: string, targetDeployAt?: string | null): ReleaseCandidate {
    const existing = this.getCandidate(id);
    if (existing) return existing;
    const row: ReleaseCandidate = {
      id,
      ref,
      submitted_at: this.now(),
      target_deploy_at: targetDeployAt ?? null,
      status: 'evaluating',
    };
    this.db
      .prepare(
        'INSERT INTO release_candidate (id, ref, submitted_at, target_deploy_at, status) VALUES (?, ?, ?, ?, ?)',
      )
      .run(row.id, row.ref, row.submitted_at, row.target_deploy_at, row.status);
    return row;
  }

  getCandidate(id: string): ReleaseCandidate | undefined {
    return this.db.prepare('SELECT * FROM release_candidate WHERE id = ?').get(id) as
      | ReleaseCandidate
      | undefined;
  }

  setStatus(id: string, status: ReleaseCandidate['status']): void {
    const info = this.db
      .prepare('UPDATE release_candidate SET status = ? WHERE id = ?')
      .run(status, id);
    if (info.changes === 0) throw new UnknownCandidateError(id);
  }

  saveCheckResult(input: {
    candidate_id: string;
    kind: CheckKind;
    result: unknown;
    unknown_fields: string[];
  }): void {
    this.requireCandidate(input.candidate_id);
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
    this.requireCandidate(input.candidate_id);
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

  /** Persist the committed go / no-go outcome and its computed risk score (Gate 1). */
  recordReleaseDecision(input: {
    candidate_id: string;
    decision: ReleaseDecision['decision'];
    risk_score: unknown;
    reason: string;
    actor: string;
  }): void {
    this.requireCandidate(input.candidate_id);
    this.db
      .prepare(
        'INSERT INTO release_decision (candidate_id, decision, risk_score_json, reason, actor, decided_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        input.candidate_id,
        input.decision,
        JSON.stringify(input.risk_score ?? null),
        input.reason,
        input.actor,
        this.now(),
      );
  }

  listReleaseDecisions(candidateId: string): ReleaseDecision[] {
    const rows = this.db
      .prepare('SELECT * FROM release_decision WHERE candidate_id = ? ORDER BY decided_at ASC')
      .all(candidateId) as Array<{
      candidate_id: string;
      decision: ReleaseDecision['decision'];
      risk_score_json: string;
      reason: string;
      actor: string;
      decided_at: string;
    }>;
    return rows.map((r) => ({
      candidate_id: r.candidate_id,
      decision: r.decision,
      risk_score: JSON.parse(r.risk_score_json),
      reason: r.reason,
      actor: r.actor,
      decided_at: r.decided_at,
    }));
  }

  /** The most recent committed go / no-go outcome, or undefined if Gate 1 has not run. */
  latestReleaseDecision(candidateId: string): ReleaseDecision | undefined {
    const all = this.listReleaseDecisions(candidateId);
    return all[all.length - 1];
  }

  /** Persist a computed RiskScore (the Code Mode aggregation output), before Gate 1. */
  saveRiskScore(input: { candidate_id: string; score: unknown; computed_by: string }): void {
    this.requireCandidate(input.candidate_id);
    this.db
      .prepare(
        'INSERT INTO risk_score (candidate_id, score_json, computed_by, computed_at) VALUES (?, ?, ?, ?)',
      )
      .run(input.candidate_id, JSON.stringify(input.score ?? null), input.computed_by, this.now());
  }

  listRiskScores(candidateId: string): Array<{ score: unknown; computed_by: string; computed_at: string }> {
    const rows = this.db
      .prepare('SELECT score_json, computed_by, computed_at FROM risk_score WHERE candidate_id = ? ORDER BY computed_at ASC')
      .all(candidateId) as Array<{ score_json: string; computed_by: string; computed_at: string }>;
    return rows.map((r) => ({ score: JSON.parse(r.score_json), computed_by: r.computed_by, computed_at: r.computed_at }));
  }

  saveCommsDraft(input: {
    candidate_id: string;
    channel: string;
    content: string;
    status: CommsDraftStatus;
  }): void {
    this.saveCommsDrafts({
      candidate_id: input.candidate_id,
      status: input.status,
      drafts: [{ channel: input.channel, content: input.content }],
    });
  }

  /** Persist every channel draft for one Gate 2 handoff in a single transaction. */
  saveCommsDrafts(input: {
    candidate_id: string;
    status: CommsDraftStatus;
    drafts: Array<{ channel: string; content: string }>;
  }): void {
    this.requireCandidate(input.candidate_id);
    const insert = this.db.prepare(
      'INSERT INTO comms_draft (candidate_id, channel, content, status, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    const now = this.now();
    const writeAll = this.db.transaction(
      (drafts: Array<{ channel: string; content: string }>) => {
        for (const d of drafts) {
          insert.run(input.candidate_id, d.channel, d.content, input.status, now);
        }
      },
    );
    writeAll(input.drafts);
  }

  /**
   * Record a comms send. In this local build "send" is a mock — no real Slack/mail
   * call — but the delivery record is written exactly as a real integration would,
   * so the evidence pack and the demo show a genuine "sent" state.
   */
  recordCommsSend(input: {
    candidate_id: string;
    deliveries: Array<{ channel: string; target: string; delivery_ref: string }>;
  }): { sent_at: string } {
    this.requireCandidate(input.candidate_id);
    const now = this.now();
    const insert = this.db.prepare(
      'INSERT INTO comms_delivery (candidate_id, channel, target, delivery_ref, sent_at) VALUES (?, ?, ?, ?, ?)',
    );
    this.db.transaction((deliveries: typeof input.deliveries) => {
      for (const d of deliveries) {
        insert.run(input.candidate_id, d.channel, d.target, d.delivery_ref, now);
      }
    })(input.deliveries);
    return { sent_at: now };
  }

  listCommsDeliveries(candidateId: string): Array<{
    channel: string;
    target: string;
    delivery_ref: string;
    sent_at: string;
  }> {
    return this.db
      .prepare(
        'SELECT channel, target, delivery_ref, sent_at FROM comms_delivery WHERE candidate_id = ? ORDER BY sent_at ASC',
      )
      .all(candidateId) as Array<{ channel: string; target: string; delivery_ref: string; sent_at: string }>;
  }

  linkSchedule(candidateId: string, scheduleId: string): void {
    this.requireCandidate(candidateId);
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
      risk_scores: this.listRiskScores(candidateId),
      decisions: this.listDecisions(candidateId),
      release_decisions: this.listReleaseDecisions(candidateId),
      comms_deliveries: this.listCommsDeliveries(candidateId),
      schedule_id: this.getScheduleLink(candidateId),
    };
  }
}
