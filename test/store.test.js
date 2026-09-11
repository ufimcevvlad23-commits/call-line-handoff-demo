import test from "node:test";
import assert from "node:assert/strict";
import { CallStore } from "../lib/store.js";
import { applyCdrToStoredCall, readinessForCaller, reconcileCallerAllowlist, reconcileUnmatchedCdr } from "../lib/pipeline.js";

function event(overrides = {}) {
  return {
    callId: "call-1",
    sessionId: "session-1",
    externalAccessId: "external-1",
    clientPhone: "79991234567",
    successfulCallerId: "",
    actualizer: "Актуализатор",
    result: "qualified",
    entityType: "lead",
    connectedAt: "2026-09-10T10:00:00.000Z",
    source: "test",
    ...overrides
  };
}

test("deduplicates a call and preserves its CRM identity", () => {
  const store = new CallStore(":memory:");
  try {
    const first = store.upsertCall(event(), { qualified: true, state: "waiting_caller_id", crmSyncState: "pending" });
    store.markCrmSynced("call-1", { entityType: "lead", entityId: "42" });
    const duplicate = store.upsertCall(event({ actualizer: "Уточнённое имя" }), { qualified: true, state: "waiting_caller_id", crmSyncState: "pending" });
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(store.dashboard().total, 1);
    assert.equal(store.getCall("call-1").crm_entity_id, "42");
  } finally {
    store.close();
  }
});

test("resolves a CRM form to an observed Skorozvon call by phone and time", () => {
  const store = new CallStore(":memory:");
  try {
    store.upsertCall(event(), { qualified: false, state: "observed" });
    const found = store.findCallForForm({ clientPhone: "79991234567", occurredAt: "2026-09-10T10:05:00.000Z" });
    assert.equal(found.skorozvon_call_id, "call-1");
    assert.equal(store.findCallForForm({ clientPhone: "79991234567", occurredAt: "2026-09-10T12:00:00.000Z" }), null);
  } finally {
    store.close();
  }
});

test("matches simulated CDR by session and moves a qualified call to ready", () => {
  const store = new CallStore(":memory:");
  try {
    store.upsertCall(event(), { qualified: true, state: "waiting_caller_id", crmSyncState: "synced" });
    const cdr = {
      eventId: "cdr-1",
      sessionId: "session-1",
      clientPhone: "79991234567",
      callerId: "79031112233",
      disposition: "ANSWERED",
      occurredAt: "2026-09-10T10:01:00.000Z"
    };
    assert.equal(store.addCdr(cdr).created, true);
    assert.equal(store.addCdr(cdr).created, false);
    const matched = store.matchCallForCdr(cdr);
    assert.equal(matched.skorozvon_call_id, "call-1");
    store.linkCdr(cdr.eventId, matched.skorozvon_call_id);
    store.setCallState(matched.skorozvon_call_id, "ready", {
      callerId: cdr.callerId,
      lineId: "beeline-trunk-1",
      crmSyncState: "pending",
      lastError: null
    });
    const ready = store.getCall("call-1");
    assert.equal(ready.state, "ready");
    assert.equal(ready.successful_caller_id, "79031112233");
    assert.equal(ready.line_id, "beeline-trunk-1");
  } finally {
    store.close();
  }
});

test("matches CDR by client phone inside the configured time window", () => {
  const store = new CallStore(":memory:");
  try {
    store.upsertCall(event({ sessionId: "" }), { qualified: true, state: "waiting_caller_id", crmSyncState: "pending" });
    const matched = store.matchCallForCdr({ clientPhone: "79991234567", occurredAt: "2026-09-10T10:08:00.000Z" });
    assert.equal(matched.skorozvon_call_id, "call-1");
    const missed = store.matchCallForCdr({ clientPhone: "79991234567", occurredAt: "2026-09-10T11:00:00.000Z" });
    assert.equal(missed, null);
  } finally {
    store.close();
  }
});

test("requires both an allowlisted caller id and a mapped SIP endpoint", () => {
  const ready = readinessForCaller("79031112233", {
    ALLOWED_CALLER_IDS: "79031112233",
    LINE_MAP_JSON: '{"79031112233":"beeline-trunk-1"}'
  });
  assert.deepEqual(ready, { state: "ready", lineId: "beeline-trunk-1" });
  assert.equal(readinessForCaller("79031112233", { ALLOWED_CALLER_IDS: "", LINE_MAP_JSON: "{}" }).state, "caller_unverified");
  assert.equal(readinessForCaller("", {}).state, "waiting_caller_id");
});

test("schedules exponential retry after a CRM error", () => {
  const store = new CallStore(":memory:");
  try {
    store.upsertCall(event(), { qualified: true, state: "waiting_caller_id", crmSyncState: "pending" });
    const failed = store.markCrmError("call-1", "temporary error");
    assert.equal(failed.crm_sync_state, "error");
    assert.equal(failed.retry_count, 1);
    assert.match(failed.last_error, /temporary error/);
    assert.ok(Date.parse(failed.next_retry_at) > Date.now());
  } finally {
    store.close();
  }
});

test("reconciles an answered CDR that arrived before the CRM form", () => {
  const store = new CallStore(":memory:");
  const oldAllowed = process.env.ALLOWED_CALLER_IDS;
  const oldMap = process.env.LINE_MAP_JSON;
  process.env.ALLOWED_CALLER_IDS = "79031112233";
  process.env.LINE_MAP_JSON = '{"79031112233":"beeline-trunk-1"}';
  try {
    store.addCdr({
      eventId: "cdr-before-form",
      sessionId: "session-1",
      clientPhone: "79991234567",
      callerId: "79031112233",
      disposition: "ANSWERED",
      occurredAt: "2026-09-10T10:01:00.000Z"
    });
    store.upsertCall(event(), { qualified: true, state: "waiting_caller_id", crmSyncState: "pending" });
    assert.equal(reconcileUnmatchedCdr(store), 1);
    assert.equal(store.getCall("call-1").state, "ready");
  } finally {
    if (oldAllowed === undefined) delete process.env.ALLOWED_CALLER_IDS; else process.env.ALLOWED_CALLER_IDS = oldAllowed;
    if (oldMap === undefined) delete process.env.LINE_MAP_JSON; else process.env.LINE_MAP_JSON = oldMap;
    store.close();
  }
});

test("automatically readies a previously unverified caller after allowlist update", () => {
  const store = new CallStore(":memory:");
  const oldAllowed = process.env.ALLOWED_CALLER_IDS;
  const oldMap = process.env.LINE_MAP_JSON;
  try {
    process.env.ALLOWED_CALLER_IDS = "";
    process.env.LINE_MAP_JSON = "{}";
    store.upsertCall(event(), { qualified: true, state: "waiting_caller_id", crmSyncState: "synced" });
    applyCdrToStoredCall(store, {
      eventId: "cdr-unverified",
      sessionId: "session-1",
      clientPhone: "79991234567",
      callerId: "79031112233",
      disposition: "ANSWERED",
      occurredAt: "2026-09-10T10:01:00.000Z"
    });
    assert.equal(store.getCall("call-1").state, "caller_unverified");
    process.env.ALLOWED_CALLER_IDS = "79031112233";
    process.env.LINE_MAP_JSON = '{"79031112233":"beeline-trunk-1"}';
    assert.equal(reconcileCallerAllowlist(store), 1);
    assert.equal(store.getCall("call-1").state, "ready");
  } finally {
    if (oldAllowed === undefined) delete process.env.ALLOWED_CALLER_IDS; else process.env.ALLOWED_CALLER_IDS = oldAllowed;
    if (oldMap === undefined) delete process.env.LINE_MAP_JSON; else process.env.LINE_MAP_JSON = oldMap;
    store.close();
  }
});

test("trusts a caller id only after an answered PBX CDR", () => {
  const store = new CallStore(":memory:");
  const previous = {
    autoTrust: process.env.AUTO_TRUST_ANSWERED_CALLER_IDS,
    defaultTrunk: process.env.DEFAULT_TRUNK_ENDPOINT,
    allowed: process.env.ALLOWED_CALLER_IDS,
    lineMap: process.env.LINE_MAP_JSON
  };
  try {
    process.env.AUTO_TRUST_ANSWERED_CALLER_IDS = "true";
    process.env.DEFAULT_TRUNK_ENDPOINT = "beeline-trunk-1";
    process.env.ALLOWED_CALLER_IDS = "";
    process.env.LINE_MAP_JSON = "{}";
    store.upsertCall(event(), { qualified: true, state: "waiting_caller_id", crmSyncState: "synced" });
    const result = applyCdrToStoredCall(store, {
      eventId: "cdr-observed-caller",
      sessionId: "session-1",
      clientPhone: "79991234567",
      callerId: "79031112233",
      disposition: "ANSWERED",
      occurredAt: "2026-09-10T10:01:00.000Z"
    });
    assert.equal(result.ready, true);
    assert.equal(store.getVerifiedCallerId("79031112233").line_id, "beeline-trunk-1");
    assert.equal(store.getCall("call-1").state, "ready");
  } finally {
    for (const [key, value] of Object.entries({
      AUTO_TRUST_ANSWERED_CALLER_IDS: previous.autoTrust,
      DEFAULT_TRUNK_ENDPOINT: previous.defaultTrunk,
      ALLOWED_CALLER_IDS: previous.allowed,
      LINE_MAP_JSON: previous.lineMap
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    store.close();
  }
});
