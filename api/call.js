import { originateManagerBridge } from "../lib/asterisk.js";
import { getCrmEntity } from "../lib/bitrix.js";
import { assertAllowedCallerId, getFieldMap, normalizePhone, parseLineMap } from "../lib/calls.js";
import { isAuthorized, json, readJson } from "../lib/http.js";
import { verifyEntitySignature } from "../lib/signing.js";
import { getStore } from "../lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Используйте POST" });
  let attemptedCallId = "";
  let originateStarted = false;
  try {
    if (process.env.CALLING_ENABLED !== "true") {
      return json(res, 503, { ok: false, error: "Исходящие звонки отключены до настройки SIP-транка" });
    }
    if (!process.env.MANAGER_ACTION_SECRET) return json(res, 503, { ok: false, error: "Не настроена авторизация менеджера" });
    const body = await readJson(req);
    const signed = verifyEntitySignature(body.entityType, body.entityId, body.signature, process.env.MANAGER_ACTION_SECRET);
    if (!isAuthorized(req, process.env.MANAGER_ACTION_SECRET) && !signed) {
      return json(res, 401, { ok: false, error: "Нет доступа к звонку" });
    }
    const fieldMap = getFieldMap();
    const entity = await getCrmEntity(body.entityType, String(body.entityId));
    const standardPhone = Array.isArray(entity.PHONE) ? entity.PHONE[0]?.VALUE : "";
    const clientPhone = normalizePhone(entity[fieldMap.clientPhone] || standardPhone);
    const callerId = normalizePhone(entity[fieldMap.successfulCallerId]);
    const callId = String(entity[fieldMap.skorozvonCallId] || "");
    attemptedCallId = callId;
    assertAllowedCallerId(callerId, process.env.ALLOWED_CALLER_IDS);
    const lineMap = parseLineMap(process.env.LINE_MAP_JSON);
    const lineId = String(lineMap[callerId] || "");
    if (clientPhone.length !== 11 || callerId.length !== 11 || !lineId) {
      return json(res, 400, { ok: false, error: "В CRM ещё нет подтверждённого телефона, Caller ID или SIP-линии" });
    }
    originateStarted = true;
    const result = await originateManagerBridge({
      managerChannel: process.env.ASTERISK_MANAGER_CHANNEL,
      clientPhone,
      callerId,
      callId,
      lineId
    });
    const store = getStore();
    if (callId && store.getCall(callId)) store.setCallState(callId, "call_requested", { lastError: null });
    store.audit("manager_call_requested", callId, { entityId: String(body.entityId), actionId: result.actionId });
    return json(res, 200, { ok: true, mode: "live", call: { callerId: `***${callerId.slice(-4)}`, lineId }, result });
  } catch (error) {
    const store = getStore();
    if (originateStarted && attemptedCallId && store.getCall(attemptedCallId)) {
      store.setCallState(attemptedCallId, "call_failed", { lastError: error.message });
    }
    store.audit("manager_call_failed", attemptedCallId, { error: error.message });
    return json(res, 500, { ok: false, error: error.message });
  }
}
