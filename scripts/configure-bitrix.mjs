import process from "node:process";
import { createInterface } from "node:readline/promises";

const input = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
const baseUrl = String(process.env.BITRIX24_WEBHOOK_URL || await input.question("")).trim().replace(/\/$/, "");
input.close();

if (!/^https:\/\/[^/]+\.bitrix24\.ru\/rest\/\d+\/[a-z0-9]+$/i.test(baseUrl)) {
  throw new Error("Некорректный адрес входящего вебхука Bitrix24");
}

async function call(method, params = {}) {
  const response = await fetch(`${baseUrl}/${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`${method}: ${data.error_description || data.error || response.status}`);
  }
  return data.result;
}

const specs = [
  ["clientPhone", "SKZ_CLIENT_PHONE", "Телефон клиента (мост)"],
  ["successfulCallerId", "SKZ_SUCCESS_CALLER_ID", "Номер успешного дозвона"],
  ["successLineId", "SKZ_SUCCESS_LINE_ID", "ID исходящей SIP-линии"],
  ["skorozvonCallId", "SKZ_CALL_ID", "ID звонка Скорозвона"],
  ["actualizer", "SKZ_ACTUALIZER", "Актуализатор", "string"],
  ["callLink", "SKZ_CALL_LINK", "Позвонить с номера успешного дозвона", "url"],
  ["handoffStatus", "SKZ_STATUS", "Статус передачи номера"],
  ["sessionId", "SKZ_SESSION_ID", "Session ID Скорозвона"],
  ["externalAccessId", "SKZ_EXTERNAL_ACCESS_ID", "External access ID Скорозвона"],
  ["lastError", "SKZ_LAST_ERROR", "Последняя ошибка интеграции"]
];

const fieldMap = {};
for (const [key, xmlId, label, type = "string"] of specs) {
  let found = await call("crm.lead.userfield.list", {
    filter: { XML_ID: xmlId },
    select: ["ID", "FIELD_NAME", "XML_ID"]
  });
  let field = Array.isArray(found) ? found[0] : null;
  if (!field) {
    const id = await call("crm.lead.userfield.add", {
      fields: {
        FIELD_NAME: xmlId,
        USER_TYPE_ID: type,
        XML_ID: xmlId,
        SORT: "500",
        MULTIPLE: "N",
        MANDATORY: "N",
        SHOW_FILTER: "I",
        SHOW_IN_LIST: "Y",
        EDIT_FORM_LABEL: { ru: label },
        LIST_COLUMN_LABEL: { ru: label },
        LIST_FILTER_LABEL: { ru: label }
      }
    });
    field = await call("crm.lead.userfield.get", { id });
  }
  fieldMap[key] = field.FIELD_NAME;
}

const profile = await call("profile");
const statuses = await call("crm.status.list", {
  filter: { ENTITY_ID: "STATUS" },
  order: { SORT: "ASC" }
});
const firstStatus = (Array.isArray(statuses) ? statuses : []).find((status) => status.STATUS_ID);

console.log(JSON.stringify({
  ok: true,
  managerId: String(profile.ID),
  managerName: [profile.LAST_NAME, profile.NAME].filter(Boolean).join(" "),
  leadStatusId: firstStatus?.STATUS_ID || "NEW",
  leadStatusName: firstStatus?.NAME || "Новый",
  fieldMap
}, null, 2));
