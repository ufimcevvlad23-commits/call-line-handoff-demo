import { normalizeSkorozvonEvent, validateEvent } from "../lib/calls.js";
import { isAuthorized, json, readJson } from "../lib/http.js";
import { queueQualifiedEvent } from "../lib/pipeline.js";
import { getStore } from "../lib/store.js";
import { fetchRecentConnectedCalls, isSkorozvonConfigured } from "../lib/skorozvon.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Используйте POST" });
  try {
    const live = Boolean(process.env.BITRIX24_WEBHOOK_URL);
    const ingestionEnabled = process.env.INGESTION_ENABLED === "true" || process.env.CALL_BRIDGE_ENABLED === "true";
    if (live && !ingestionEnabled) return json(res, 503, { ok: false, error: "Приём CRM-форм Скорозвона выключен" });
    if (live && !process.env.SKOROZVON_WEBHOOK_SECRET) {
      return json(res, 503, { ok: false, error: "Боевой режим заблокирован: не настроена подпись Скорозвона" });
    }
    if (!isAuthorized(req, process.env.SKOROZVON_WEBHOOK_SECRET)) {
      return json(res, 401, { ok: false, error: "Неверная подпись интеграции" });
    }
    const event = normalizeSkorozvonEvent(await readJson(req));
    const store = getStore();
    if (!event.callId && event.clientPhone.length === 11) {
      let candidate = store.findCallForForm({
        sessionId: event.sessionId,
        externalAccessId: event.externalAccessId,
        clientPhone: event.clientPhone,
        occurredAt: event.connectedAt || event.startedAt
      });
      if (!candidate && isSkorozvonConfigured()) {
        try {
          for (const observed of await fetchRecentConnectedCalls()) store.upsertCall(observed, { qualified: false, state: "observed" });
          candidate = store.findCallForForm({
            sessionId: event.sessionId,
            externalAccessId: event.externalAccessId,
            clientPhone: event.clientPhone,
            occurredAt: event.connectedAt || event.startedAt
          });
        } catch (error) {
          store.audit("skorozvon_lookup_failed", "", { error: error.message });
        }
      }
      if (candidate) {
        event.callId = candidate.skorozvon_call_id;
        event.sessionId ||= candidate.session_id || "";
        event.externalAccessId ||= candidate.external_access_id || "";
        event.actualizer ||= candidate.actualizer || "";
        event.connectedAt ||= candidate.connected_at || "";
      }
    }
    const errors = validateEvent(event);
    const retryableLookup = !event.callId && errors.length === 1 && errors[0] === "Не передан ID звонка Скорозвона";
    if (errors.length) return json(res, retryableLookup ? 409 : 400, {
      ok: false,
      errors,
      retryable: retryableLookup,
      error: retryableLookup ? "Разговор ещё не найден в Скорозвоне; форму можно безопасно отправить повторно" : undefined
    });
    const result = await queueQualifiedEvent(store, event);
    return json(res, result.queued ? 202 : 200, {
      ok: true,
      mode: live ? "live" : "demo",
      deduplicated: !result.created,
      queued: result.queued,
      state: result.call.state,
      entity: result.entity,
      callId: event.callId,
      error: result.error
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
}
