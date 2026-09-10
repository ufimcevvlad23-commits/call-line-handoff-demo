import { buildCrmFields, getFieldMap, normalizeSkorozvonEvent, parseLineMap, validateEvent, assertAllowedCallerId } from "../lib/calls.js";
import { bitrixCall, upsertCrmEntity } from "../lib/bitrix.js";
import { isAuthorized, json, readJson } from "../lib/http.js";
import { buildManagerLink } from "../lib/signing.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Используйте POST" });
  try {
    if (process.env.BITRIX24_WEBHOOK_URL && process.env.CALL_BRIDGE_ENABLED !== "true") {
      return json(res, 503, { ok: false, error: "Приём звонков временно отключён до настройки SIP-линий" });
    }
    if (process.env.BITRIX24_WEBHOOK_URL && !process.env.SKOROZVON_WEBHOOK_SECRET) {
      return json(res, 503, { ok: false, error: "Боевой режим заблокирован: не настроена подпись Скорозвона" });
    }
    if (!isAuthorized(req, process.env.SKOROZVON_WEBHOOK_SECRET)) {
      return json(res, 401, { ok: false, error: "Неверная подпись интеграции" });
    }
    const body = await readJson(req);
    const event = normalizeSkorozvonEvent(body);
    const errors = validateEvent(event);
    if (errors.length) return json(res, 400, { ok: false, errors });

    assertAllowedCallerId(event.successfulCallerId, process.env.ALLOWED_CALLER_IDS);
    const lineMap = parseLineMap(process.env.LINE_MAP_JSON);
    const lineId = lineMap[event.successfulCallerId] ?? "";
    const fieldMap = getFieldMap();
    const fields = buildCrmFields(event, lineId, {
      leadStatusId: process.env.BITRIX_LEAD_STATUS_ID || "NEW",
      assignedById: process.env.BITRIX_MANAGER_ID || "",
      fieldMap
    });

    if (!process.env.BITRIX24_WEBHOOK_URL) {
      return json(res, 200, {
        ok: true,
        mode: "demo",
        message: "Номер успешного дозвона получен и подготовлен для записи в CRM",
        entity: { entityType: event.entityType, entityId: "DEMO-1042", created: true },
        fields
      });
    }

    const entity = await upsertCrmEntity(event, fields, fieldMap.skorozvonCallId);
    if (event.entityType === "lead" && process.env.PUBLIC_BASE_URL && process.env.MANAGER_ACTION_SECRET) {
      const callLink = buildManagerLink(
        process.env.PUBLIC_BASE_URL,
        entity.entityType,
        entity.entityId,
        process.env.MANAGER_ACTION_SECRET
      );
      await bitrixCall("crm.lead.update", {
        id: entity.entityId,
        fields: { [fieldMap.callLink]: callLink }
      });
    }
    return json(res, 200, { ok: true, mode: "live", entity, fields });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
}
