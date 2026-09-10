import { assertAllowedCallerId, getFieldMap, normalizePhone, parseLineMap } from "../lib/calls.js";
import { getCrmEntity, startBitrixCallback } from "../lib/bitrix.js";
import { isAuthorized, json, readJson } from "../lib/http.js";
import { verifyEntitySignature } from "../lib/signing.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Используйте POST" });
  try {
    if (process.env.BITRIX24_WEBHOOK_URL && process.env.CALL_BRIDGE_ENABLED !== "true") {
      return json(res, 503, { ok: false, error: "Исходящие звонки отключены до настройки SIP-линий" });
    }
    if (process.env.BITRIX24_WEBHOOK_URL && !process.env.MANAGER_ACTION_SECRET) {
      return json(res, 503, { ok: false, error: "Боевой режим заблокирован: не настроена авторизация менеджера" });
    }
    const body = await readJson(req);
    const signed = verifyEntitySignature(body.entityType, body.entityId, body.signature, process.env.MANAGER_ACTION_SECRET);
    if (!isAuthorized(req, process.env.MANAGER_ACTION_SECRET) && !signed) {
      return json(res, 401, { ok: false, error: "Нет доступа к звонку" });
    }
    const fieldMap = getFieldMap();
    let entity;

    if (process.env.BITRIX24_WEBHOOK_URL && body.entityId) {
      entity = await getCrmEntity(body.entityType, String(body.entityId));
    } else {
      entity = {
        UF_CRM_CLIENT_PHONE: body.clientPhone,
        UF_CRM_SUCCESS_CALLER_ID: body.successfulCallerId,
        UF_CRM_SUCCESS_LINE_ID: body.lineId
      };
    }

    const standardPhone = Array.isArray(entity.PHONE) ? entity.PHONE[0]?.VALUE : "";
    const clientPhone = normalizePhone(entity[fieldMap.clientPhone] || standardPhone);
    const callerId = normalizePhone(entity[fieldMap.successfulCallerId]);
    assertAllowedCallerId(callerId, process.env.ALLOWED_CALLER_IDS);
    const lineMap = parseLineMap(process.env.LINE_MAP_JSON);
    const lineId = String(entity[fieldMap.successLineId] || lineMap[callerId] || "");

    if (clientPhone.length !== 11 || callerId.length !== 11) {
      return json(res, 400, { ok: false, error: "В CRM отсутствует телефон клиента или успешный Caller ID" });
    }

    if (!process.env.BITRIX24_WEBHOOK_URL || !lineId) {
      return json(res, 200, {
        ok: true,
        mode: "demo",
        message: `Звонок подготовлен: клиенту будет показан +${callerId}`,
        call: { clientPhone, callerId, lineId: lineId || "DEMO-LINE" }
      });
    }

    const result = await startBitrixCallback({ lineId, clientPhone });
    return json(res, 200, { ok: true, mode: "live", call: { clientPhone, callerId, lineId }, result });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
}
