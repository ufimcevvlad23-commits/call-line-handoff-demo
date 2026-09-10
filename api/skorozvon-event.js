import { buildCrmFields, normalizeSkorozvonEvent, parseLineMap, validateEvent, assertAllowedCallerId } from "../lib/calls.js";
import { upsertCrmEntity } from "../lib/bitrix.js";
import { isAuthorized, json, readJson } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Используйте POST" });
  try {
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
    const fields = buildCrmFields(event, lineId);

    if (!process.env.BITRIX24_WEBHOOK_URL) {
      return json(res, 200, {
        ok: true,
        mode: "demo",
        message: "Номер успешного дозвона получен и подготовлен для записи в CRM",
        entity: { entityType: event.entityType, entityId: "DEMO-1042", created: true },
        fields
      });
    }

    const entity = await upsertCrmEntity(event, fields);
    return json(res, 200, { ok: true, mode: "live", entity, fields });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
}
