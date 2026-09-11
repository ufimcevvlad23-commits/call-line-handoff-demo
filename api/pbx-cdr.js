import { normalizePhone } from "../lib/calls.js";
import { isAuthorized, json, readJson } from "../lib/http.js";
import { applyCdrToStoredCall, syncCallToBitrix } from "../lib/pipeline.js";
import { getStore } from "../lib/store.js";

function normalizeCdr(body) {
  const payload = body?.data || body || {};
  return {
    eventId: String(payload.event_id || payload.uniqueid || payload.unique_id || "").trim(),
    callId: String(payload.call_id || payload.skorozvon_call_id || "").trim(),
    sessionId: String(payload.session_id || payload.linkedid || "").trim(),
    clientPhone: normalizePhone(payload.client_phone || payload.dst || payload.destination),
    callerId: normalizePhone(payload.caller_id || payload.src || payload.outbound_caller_id),
    disposition: String(payload.disposition || payload.status || "").toUpperCase(),
    occurredAt: String(payload.answered_at || payload.occurred_at || payload.started_at || new Date().toISOString())
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Используйте POST" });
  try {
    if (process.env.PBX_CDR_ENABLED !== "true") return json(res, 503, { ok: false, error: "Приём CDR выключен" });
    if (!process.env.PBX_CDR_SECRET) return json(res, 503, { ok: false, error: "Не настроен секрет CDR" });
    if (!isAuthorized(req, process.env.PBX_CDR_SECRET)) return json(res, 401, { ok: false, error: "Неверная подпись CDR" });
    const cdr = normalizeCdr(await readJson(req));
    if (!cdr.eventId) return json(res, 400, { ok: false, error: "Не передан уникальный ID CDR" });
    if (cdr.clientPhone && cdr.clientPhone.length !== 11) return json(res, 400, { ok: false, error: "Некорректный номер клиента в CDR" });
    const answered = new Set(["ANSWERED", "SUCCESS", "CONNECTED"]).has(cdr.disposition);
    if (answered && cdr.callerId.length !== 11) return json(res, 400, { ok: false, error: "В успешном CDR отсутствует корректный Caller ID" });
    const store = getStore();
    const inserted = store.addCdr(cdr);
    store.setIntegrationState("pbx_cdr", { status: "receiving", lastEventAt: cdr.occurredAt });
    if (!inserted.created) return json(res, 200, { ok: true, deduplicated: true });
    if (!answered) {
      store.audit("cdr_ignored_not_answered", cdr.eventId, { disposition: cdr.disposition });
      return json(res, 202, { ok: true, matched: false, reason: "not_answered" });
    }
    const match = applyCdrToStoredCall(store, cdr);
    if (!match.matched) {
      store.audit("cdr_unmatched", cdr.eventId, { sessionId: cdr.sessionId });
      return json(res, 202, { ok: true, matched: false, reason: "no_matching_call" });
    }
    let entity = null;
    if (match.call.qualified) {
      try { entity = await syncCallToBitrix(store, match.call); } catch { /* queued for retry */ }
    }
    return json(res, match.ready ? 200 : 202, { ok: true, matched: true, ready: match.ready, callId: match.call.skorozvon_call_id, entity, state: match.call.state });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
}
