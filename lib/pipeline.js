import { bitrixCall, upsertCrmEntity } from "./bitrix.js";
import { buildCrmFields, getFieldMap, handoffStatusLabel, isAllowedCallerId, parseLineMap } from "./calls.js";
import { buildManagerLink } from "./signing.js";

export function readinessForCaller(callerId, env = process.env, store = null) {
  const lineMap = parseLineMap(env.LINE_MAP_JSON);
  const verified = store?.getVerifiedCallerId?.(callerId);
  const lineId = callerId ? String(lineMap[callerId] || verified?.line_id || "") : "";
  if (!callerId) return { state: "waiting_caller_id", lineId: "" };
  if ((!isAllowedCallerId(callerId, env.ALLOWED_CALLER_IDS) && !verified) || !lineId) {
    return { state: "caller_unverified", lineId };
  }
  return { state: "ready", lineId };
}

function recordToEvent(call) {
  return {
    callId: call.skorozvon_call_id,
    sessionId: call.session_id || "",
    externalAccessId: call.external_access_id || "",
    clientPhone: call.client_phone,
    successfulCallerId: call.successful_caller_id || "",
    actualizer: call.actualizer || "",
    result: call.result || "qualified",
    entityType: call.entity_type || "lead",
    entityId: call.crm_entity_id || "",
    startedAt: call.started_at || "",
    connectedAt: call.connected_at || ""
  };
}

export async function syncCallToBitrix(store, call) {
  if (!process.env.BITRIX24_WEBHOOK_URL) return null;
  const fieldMap = getFieldMap();
  const event = recordToEvent(call);
  const fields = buildCrmFields(event, call.line_id || "", {
    leadStatusId: process.env.BITRIX_LEAD_STATUS_ID || "NEW",
    assignedById: process.env.BITRIX_MANAGER_ID || "",
    fieldMap,
    handoffStatus: handoffStatusLabel(call.state),
    lastError: call.last_error || ""
  });
  try {
    const entity = await upsertCrmEntity(event, fields, fieldMap.skorozvonCallId);
    if (entity.entityType === "lead" && process.env.PUBLIC_BASE_URL && process.env.MANAGER_ACTION_SECRET) {
      const callLink = buildManagerLink(process.env.PUBLIC_BASE_URL, entity.entityType, entity.entityId, process.env.MANAGER_ACTION_SECRET);
      await bitrixCall("crm.lead.update", { id: entity.entityId, fields: { [fieldMap.callLink]: callLink } });
    }
    store.markCrmSynced(call.skorozvon_call_id, entity);
    store.setIntegrationState("bitrix", { status: "connected", lastSyncAt: new Date().toISOString() });
    store.audit(entity.created ? "crm_lead_created" : "crm_lead_updated", call.skorozvon_call_id, {
      entityType: entity.entityType,
      entityId: entity.entityId,
      state: call.state
    });
    return entity;
  } catch (error) {
    store.markCrmError(call.skorozvon_call_id, error.message);
    store.setIntegrationState("bitrix", { status: "error", error: error.message });
    store.audit("crm_sync_failed", call.skorozvon_call_id, { error: error.message });
    throw error;
  }
}

export async function queueQualifiedEvent(store, event) {
  const existing = store.getCall(event.callId);
  const resolvedCallerId = event.successfulCallerId || existing?.successful_caller_id || "";
  const readiness = readinessForCaller(resolvedCallerId, process.env, store);
  const result = store.upsertCall({ ...event, successfulCallerId: resolvedCallerId, lineId: readiness.lineId }, {
    qualified: true,
    state: readiness.state,
    crmSyncState: "pending"
  });
  store.audit(result.created ? "qualified_event_received" : "qualified_event_deduplicated", event.callId, {
    state: result.call.state,
    source: event.source || "skorozvon_form"
  });
  reconcileUnmatchedCdr(store);
  const current = store.getCall(event.callId);
  try {
    const entity = await syncCallToBitrix(store, current);
    return { ...result, entity, queued: false, call: store.getCall(event.callId) };
  } catch (error) {
    return { ...result, entity: null, queued: true, error: error.message, call: store.getCall(event.callId) };
  }
}

export function applyCdrToStoredCall(store, cdr) {
  const answered = new Set(["ANSWERED", "SUCCESS", "CONNECTED"]).has(String(cdr.disposition || "").toUpperCase());
  if (answered && process.env.AUTO_TRUST_ANSWERED_CALLER_IDS === "true" && /^7\d{10}$/.test(cdr.callerId || "")) {
    const lineId = String(parseLineMap(process.env.LINE_MAP_JSON)[cdr.callerId] || process.env.DEFAULT_TRUNK_ENDPOINT || "");
    if (lineId) store.verifyCallerId(cdr.callerId, lineId, `cdr:${cdr.eventId}`);
  }
  const call = store.matchCallForCdr(cdr);
  if (!call) return { matched: false, ready: false, call: null };
  store.linkCdr(cdr.eventId, call.skorozvon_call_id);
  const readiness = readinessForCaller(cdr.callerId, process.env, store);
  const state = call.qualified ? readiness.state : "observed";
  const updated = store.setCallState(call.skorozvon_call_id, state, {
    callerId: cdr.callerId,
    lineId: readiness.lineId,
    crmSyncState: call.qualified ? "pending" : call.crm_sync_state,
    lastError: readiness.state === "ready" ? null : "Caller ID пока не подтверждён белым списком и картой SIP-линий"
  });
  store.audit(readiness.state === "ready" ? "caller_id_resolved" : "caller_id_unverified", call.skorozvon_call_id, { eventId: cdr.eventId });
  return { matched: true, ready: readiness.state === "ready", call: updated };
}

export function reconcileUnmatchedCdr(store, limit = 50) {
  let matched = 0;
  for (const row of store.unmatchedCdr(limit)) {
    const result = applyCdrToStoredCall(store, {
      eventId: row.event_id,
      callId: row.call_id || "",
      sessionId: row.session_id || "",
      clientPhone: row.client_phone || "",
      callerId: row.caller_id || "",
      disposition: row.disposition || "",
      occurredAt: row.occurred_at || ""
    });
    if (result.matched) matched += 1;
  }
  return matched;
}

export function reconcileCallerAllowlist(store, limit = 100) {
  let readied = 0;
  for (const call of store.callsByState("caller_unverified", limit)) {
    const readiness = readinessForCaller(call.successful_caller_id, process.env, store);
    if (readiness.state !== "ready") continue;
    store.setCallState(call.skorozvon_call_id, "ready", {
      callerId: call.successful_caller_id,
      lineId: readiness.lineId,
      crmSyncState: call.qualified ? "pending" : call.crm_sync_state,
      lastError: null
    });
    store.audit("caller_id_allowlist_reconciled", call.skorozvon_call_id, {});
    readied += 1;
  }
  return readied;
}

export async function processPendingCrm(store, limit = 20) {
  let synced = 0;
  for (const call of store.pendingCrm(limit)) {
    try {
      await syncCallToBitrix(store, call);
      synced += 1;
    } catch {
      // The store already scheduled the next exponential-backoff attempt.
    }
  }
  return synced;
}
