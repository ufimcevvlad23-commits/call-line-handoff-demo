import { bitrixCall, upsertCrmEntity } from "../lib/bitrix.js";
import { buildCrmFields, getFieldMap, normalizePhone } from "../lib/calls.js";
import { buildManagerLink } from "../lib/signing.js";

const clientPhone = normalizePhone(process.env.TEST_CLIENT_PHONE);
if (clientPhone.length !== 11) throw new Error("Укажите TEST_CLIENT_PHONE");

const event = {
  callId: "bridge-installation-test-v1",
  clientPhone,
  successfulCallerId: "",
  result: "installation-test",
  actualizer: "Тест интеграции",
  managerId: process.env.BITRIX_MANAGER_ID || "",
  entityType: "lead",
  entityId: ""
};

const fieldMap = getFieldMap();
const fields = buildCrmFields(event, "", {
  leadStatusId: process.env.BITRIX_LEAD_STATUS_ID || "NEW",
  assignedById: process.env.BITRIX_MANAGER_ID || "",
  fieldMap
});
fields.TITLE = `[ТЕСТ] Связка Скорозвон → Битрикс24 ${clientPhone}`;

const entity = await upsertCrmEntity(event, fields, fieldMap.skorozvonCallId);
const link = buildManagerLink(
  process.env.PUBLIC_BASE_URL,
  entity.entityType,
  entity.entityId,
  process.env.MANAGER_ACTION_SECRET
);
await bitrixCall("crm.lead.update", {
  id: entity.entityId,
  fields: { [fieldMap.callLink]: link }
});

const pageResponse = await fetch(link, { redirect: "manual" });
console.log(JSON.stringify({
  ok: true,
  entityType: entity.entityType,
  entityId: entity.entityId,
  created: entity.created,
  managerPageStatus: pageResponse.status
}, null, 2));
