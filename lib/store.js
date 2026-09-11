import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function nowIso() {
  return new Date().toISOString();
}

function emptyToNull(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function publicCall(row) {
  if (!row) return null;
  return {
    ...row,
    qualified: Boolean(row.qualified),
    retry_count: Number(row.retry_count || 0)
  };
}

export class CallStore {
  constructor(databasePath = ":memory:") {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    if (databasePath !== ":memory:") this.db.exec("PRAGMA journal_mode=WAL;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skorozvon_call_id TEXT NOT NULL UNIQUE,
        session_id TEXT,
        external_access_id TEXT,
        client_phone TEXT NOT NULL,
        successful_caller_id TEXT,
        line_id TEXT,
        actualizer TEXT,
        actualizer_id TEXT,
        result TEXT,
        entity_type TEXT NOT NULL DEFAULT 'lead',
        crm_entity_id TEXT,
        qualified INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'observed',
        crm_sync_state TEXT NOT NULL DEFAULT 'none',
        started_at TEXT,
        connected_at TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_error TEXT,
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS calls_phone_time_idx ON calls(client_phone, connected_at);
      CREATE INDEX IF NOT EXISTS calls_retry_idx ON calls(crm_sync_state, next_retry_at);

      CREATE TABLE IF NOT EXISTS cdr_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        call_id TEXT,
        session_id TEXT,
        client_phone TEXT,
        caller_id TEXT,
        disposition TEXT,
        occurred_at TEXT,
        matched_call_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        entity_id TEXT,
        details TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log(created_at DESC);

      CREATE TABLE IF NOT EXISTS integration_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verified_caller_ids (
        caller_id TEXT PRIMARY KEY,
        line_id TEXT NOT NULL,
        source TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  getCall(callId) {
    return publicCall(this.db.prepare("SELECT * FROM calls WHERE skorozvon_call_id = ?").get(String(callId)));
  }

  findCallForForm({ sessionId = "", externalAccessId = "", clientPhone = "", occurredAt = "" }) {
    if (sessionId) {
      const row = this.db.prepare("SELECT * FROM calls WHERE session_id=? ORDER BY updated_at DESC LIMIT 1").get(String(sessionId));
      if (row) return publicCall(row);
    }
    if (externalAccessId) {
      const row = this.db.prepare("SELECT * FROM calls WHERE external_access_id=? ORDER BY updated_at DESC LIMIT 1").get(String(externalAccessId));
      if (row) return publicCall(row);
    }
    if (!clientPhone) return null;
    const at = occurredAt || nowIso();
    return publicCall(this.db.prepare(`SELECT * FROM calls WHERE client_phone=?
      AND julianday(COALESCE(connected_at, started_at, updated_at))
        BETWEEN julianday(?, '-30 minutes') AND julianday(?, '+5 minutes')
      ORDER BY ABS(julianday(COALESCE(connected_at, started_at, updated_at)) - julianday(?)) ASC LIMIT 1`)
      .get(String(clientPhone), at, at, at));
  }

  upsertCall(event, { qualified = false, state = "observed", crmSyncState } = {}) {
    const callId = String(event.callId || "");
    if (!callId) throw new Error("Не передан ID звонка");
    const timestamp = nowIso();
    const existing = this.getCall(callId);
    const keepReadyState = existing && ["ready", "call_requested"].includes(existing.state) && !event.successfulCallerId;
    const nextState = keepReadyState ? existing.state : state;
    const nextQualified = Boolean(existing?.qualified || qualified);
    const nextCrmState = crmSyncState || (qualified ? "pending" : existing?.crm_sync_state || "none");

    if (!existing) {
      this.db.prepare(`
        INSERT INTO calls (
          skorozvon_call_id, session_id, external_access_id, client_phone,
          successful_caller_id, line_id, actualizer, actualizer_id, result,
          entity_type, crm_entity_id, qualified, state, crm_sync_state,
          started_at, connected_at, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callId, emptyToNull(event.sessionId), emptyToNull(event.externalAccessId), String(event.clientPhone || ""),
        emptyToNull(event.successfulCallerId), emptyToNull(event.lineId), emptyToNull(event.actualizer), emptyToNull(event.actualizerId), emptyToNull(event.result),
        event.entityType === "deal" ? "deal" : "lead", emptyToNull(event.entityId), nextQualified ? 1 : 0, nextState, nextCrmState,
        emptyToNull(event.startedAt), emptyToNull(event.connectedAt), emptyToNull(event.source), timestamp, timestamp
      );
      return { created: true, call: this.getCall(callId) };
    }

    const merged = {
      sessionId: event.sessionId || existing.session_id,
      externalAccessId: event.externalAccessId || existing.external_access_id,
      clientPhone: event.clientPhone || existing.client_phone,
      successfulCallerId: event.successfulCallerId || existing.successful_caller_id,
      lineId: event.lineId || existing.line_id,
      actualizer: event.actualizer || existing.actualizer,
      actualizerId: event.actualizerId || existing.actualizer_id,
      result: event.result || existing.result,
      entityType: event.entityType || existing.entity_type,
      entityId: event.entityId || existing.crm_entity_id,
      startedAt: event.startedAt || existing.started_at,
      connectedAt: event.connectedAt || existing.connected_at,
      source: event.source || existing.source
    };
    this.db.prepare(`
      UPDATE calls SET session_id=?, external_access_id=?, client_phone=?, successful_caller_id=?,
        line_id=?, actualizer=?, actualizer_id=?, result=?, entity_type=?, crm_entity_id=?,
        qualified=?, state=?, crm_sync_state=?, started_at=?, connected_at=?, source=?, updated_at=?
      WHERE skorozvon_call_id=?
    `).run(
      emptyToNull(merged.sessionId), emptyToNull(merged.externalAccessId), merged.clientPhone,
      emptyToNull(merged.successfulCallerId), emptyToNull(merged.lineId), emptyToNull(merged.actualizer),
      emptyToNull(merged.actualizerId), emptyToNull(merged.result), merged.entityType === "deal" ? "deal" : "lead",
      emptyToNull(merged.entityId), nextQualified ? 1 : 0, nextState, nextCrmState,
      emptyToNull(merged.startedAt), emptyToNull(merged.connectedAt), emptyToNull(merged.source), timestamp, callId
    );
    return { created: false, call: this.getCall(callId) };
  }

  markCrmSynced(callId, entity) {
    this.db.prepare(`UPDATE calls SET crm_entity_id=?, entity_type=?, crm_sync_state='synced',
      retry_count=0, next_retry_at=NULL, last_error=NULL, updated_at=? WHERE skorozvon_call_id=?`)
      .run(String(entity.entityId), entity.entityType, nowIso(), String(callId));
    return this.getCall(callId);
  }

  markCrmError(callId, error) {
    const current = this.getCall(callId);
    const retryCount = Number(current?.retry_count || 0) + 1;
    const delaySeconds = Math.min(3600, 15 * (2 ** Math.min(retryCount - 1, 8)));
    const nextRetry = new Date(Date.now() + delaySeconds * 1000).toISOString();
    this.db.prepare(`UPDATE calls SET crm_sync_state='error', retry_count=?, next_retry_at=?,
      last_error=?, updated_at=? WHERE skorozvon_call_id=?`)
      .run(retryCount, nextRetry, String(error).slice(0, 1000), nowIso(), String(callId));
    return this.getCall(callId);
  }

  pendingCrm(limit = 20) {
    return this.db.prepare(`SELECT * FROM calls WHERE qualified=1
      AND crm_sync_state IN ('pending','error')
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY updated_at ASC LIMIT ?`).all(nowIso(), Number(limit)).map(publicCall);
  }

  unmatchedCdr(limit = 50) {
    return this.db.prepare(`SELECT * FROM cdr_events WHERE matched_call_id IS NULL
      AND disposition IN ('ANSWERED','SUCCESS','CONNECTED') ORDER BY id ASC LIMIT ?`).all(Number(limit));
  }

  callsByState(state, limit = 100) {
    return this.db.prepare("SELECT * FROM calls WHERE state=? ORDER BY updated_at ASC LIMIT ?")
      .all(String(state), Number(limit)).map(publicCall);
  }

  setCallState(callId, state, values = {}) {
    const current = this.getCall(callId);
    if (!current) return null;
    const crmState = values.crmSyncState || current.crm_sync_state;
    this.db.prepare(`UPDATE calls SET state=?, successful_caller_id=?, line_id=?,
      crm_sync_state=?, last_error=?, updated_at=? WHERE skorozvon_call_id=?`)
      .run(
        state,
        emptyToNull(values.callerId || current.successful_caller_id),
        emptyToNull(values.lineId || current.line_id),
        crmState,
        values.lastError === undefined ? current.last_error : emptyToNull(values.lastError),
        nowIso(),
        String(callId)
      );
    return this.getCall(callId);
  }

  addCdr(cdr) {
    const result = this.db.prepare(`INSERT OR IGNORE INTO cdr_events
      (event_id, call_id, session_id, client_phone, caller_id, disposition, occurred_at, matched_call_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(cdr.eventId, emptyToNull(cdr.callId), emptyToNull(cdr.sessionId), emptyToNull(cdr.clientPhone),
        emptyToNull(cdr.callerId), emptyToNull(cdr.disposition), emptyToNull(cdr.occurredAt), emptyToNull(cdr.matchedCallId), nowIso());
    return { created: result.changes > 0 };
  }

  matchCallForCdr(cdr) {
    if (cdr.callId) {
      const exact = this.getCall(cdr.callId);
      if (exact) return exact;
    }
    if (cdr.sessionId) {
      const bySession = this.db.prepare("SELECT * FROM calls WHERE session_id=? ORDER BY updated_at DESC LIMIT 1").get(cdr.sessionId);
      if (bySession) return publicCall(bySession);
    }
    if (!cdr.clientPhone) return null;
    const occurredAt = cdr.occurredAt || nowIso();
    return publicCall(this.db.prepare(`SELECT * FROM calls
      WHERE client_phone=? AND qualified=1
        AND julianday(COALESCE(connected_at, started_at, updated_at))
          BETWEEN julianday(?, '-20 minutes') AND julianday(?, '+20 minutes')
      ORDER BY ABS(julianday(COALESCE(connected_at, started_at, updated_at)) - julianday(?)) ASC LIMIT 1`)
      .get(cdr.clientPhone, occurredAt, occurredAt, occurredAt));
  }

  linkCdr(eventId, callId) {
    this.db.prepare("UPDATE cdr_events SET matched_call_id=? WHERE event_id=?").run(String(callId), String(eventId));
  }

  audit(eventType, entityId = "", details = {}) {
    this.db.prepare("INSERT INTO audit_log(event_type, entity_id, details, created_at) VALUES (?, ?, ?, ?)")
      .run(String(eventType), emptyToNull(entityId), JSON.stringify(details), nowIso());
  }

  setIntegrationState(key, value) {
    this.db.prepare(`INSERT INTO integration_state(key,value,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(String(key), typeof value === "string" ? value : JSON.stringify(value), nowIso());
  }

  integrationStates() {
    return Object.fromEntries(this.db.prepare("SELECT key,value,updated_at FROM integration_state").all()
      .map((row) => [row.key, { value: row.value, updatedAt: row.updated_at }]));
  }

  verifyCallerId(callerId, lineId, source = "answered_cdr") {
    const normalizedCaller = String(callerId || "");
    const normalizedLine = String(lineId || "");
    if (!/^7\d{10}$/.test(normalizedCaller) || !normalizedLine) {
      throw new Error("Нельзя подтвердить Caller ID без корректного номера и SIP-линии");
    }
    const timestamp = nowIso();
    this.db.prepare(`INSERT INTO verified_caller_ids(caller_id,line_id,source,first_seen_at,last_seen_at)
      VALUES(?,?,?,?,?) ON CONFLICT(caller_id) DO UPDATE SET
      line_id=excluded.line_id, source=excluded.source, last_seen_at=excluded.last_seen_at`)
      .run(normalizedCaller, normalizedLine, String(source), timestamp, timestamp);
    return this.getVerifiedCallerId(normalizedCaller);
  }

  getVerifiedCallerId(callerId) {
    return this.db.prepare("SELECT caller_id,line_id,source,first_seen_at,last_seen_at FROM verified_caller_ids WHERE caller_id=?")
      .get(String(callerId || "")) || null;
  }

  dashboard({ state = "", limit = 50 } = {}) {
    const where = state ? "WHERE state=?" : "";
    const args = state ? [state, Number(limit)] : [Number(limit)];
    const calls = this.db.prepare(`SELECT skorozvon_call_id, client_phone, successful_caller_id,
      state, crm_sync_state, crm_entity_id, connected_at, updated_at, retry_count, last_error
      FROM calls ${where} ORDER BY updated_at DESC LIMIT ?`).all(...args);
    const counts = Object.fromEntries(this.db.prepare("SELECT state, COUNT(*) count FROM calls GROUP BY state").all()
      .map((row) => [row.state, Number(row.count)]));
    const total = Number(this.db.prepare("SELECT COUNT(*) count FROM calls").get().count);
    const qualified = Number(this.db.prepare("SELECT COUNT(*) count FROM calls WHERE qualified=1").get().count);
    const crmSynced = Number(this.db.prepare("SELECT COUNT(*) count FROM calls WHERE crm_sync_state='synced'").get().count);
    const errors = Number(this.db.prepare("SELECT COUNT(*) count FROM calls WHERE crm_sync_state='error' OR state='call_failed'").get().count);
    const audit = this.db.prepare("SELECT event_type, entity_id, details, created_at FROM audit_log ORDER BY id DESC LIMIT 30").all();
    return { total, qualified, crmSynced, errors, counts, calls, audit, integrations: this.integrationStates(), generatedAt: nowIso() };
  }
}

let sharedStore;
let sharedPath;

export function getStore() {
  const databasePath = process.env.DATABASE_PATH || resolve("var", "call-bridge.sqlite");
  if (!sharedStore || sharedPath !== databasePath) {
    sharedStore?.close();
    sharedPath = databasePath;
    sharedStore = new CallStore(databasePath);
  }
  return sharedStore;
}
