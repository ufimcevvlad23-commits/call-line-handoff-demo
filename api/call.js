import { assertAllowedCallerId, normalizePhone, parseLineMap } from "../lib/calls.js";
import { getCrmEntity, startBitrixCallback } from "../lib/bitrix.js";
import { isAuthorized, json, readJson } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Используйте POST" });
  try {
    if (process.env.BITRIX24_WEBHOOK_URL && !process.env.MANAGER_ACTION_SECRET) {
      return json(res, 503, { ok: false, error: "Боевой режим заблокирован: не настроена авторизация менеджера" });
    }
    if (!isAuthorized(req, process.env.MANAGER_ACTION_SECRET)) {
      return json(res, 401, { ok: false, error: "Нет доступа к звонку" });
    }
    const body = await readJson(req);
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

    const clientPhone = normalizePhone(entity.UF_CRM_CLIENT_PHONE);
    const callerId = normalizePhone(entity.UF_CRM_SUCCESS_CALLER_ID);
    assertAllowedCallerId(callerId, process.env.ALLOWED_CALLER_IDS);
    const lineMap = parseLineMap(process.env.LINE_MAP_JSON);
    const lineId = String(entity.UF_CRM_SUCCESS_LINE_ID || lineMap[callerId] || "");

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
