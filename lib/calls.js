const PHONE_KEYS = ["client_phone", "clientPhone", "phone", "contact_phone", "to_number"];
const CALLER_KEYS = [
  "successful_caller_id",
  "successfulCallerId",
  "caller_id",
  "callerId",
  "from_number",
  "fromNumber",
  "line_number",
  "ani"
];
const CALL_ID_KEYS = ["call_id", "callId", "external_call_id", "externalCallId", "id"];

export function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  return digits;
}

function firstValue(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return undefined;
}

export function normalizeSkorozvonEvent(body) {
  const payload = body?.data ?? body?.payload ?? body ?? {};
  return {
    callId: String(firstValue(payload, CALL_ID_KEYS) ?? "").trim(),
    clientPhone: normalizePhone(firstValue(payload, PHONE_KEYS)),
    successfulCallerId: normalizePhone(firstValue(payload, CALLER_KEYS)),
    result: String(payload.result ?? payload.status ?? "qualified").trim(),
    actualizer: String(payload.actualizer ?? payload.operator_name ?? "").trim(),
    managerId: String(payload.manager_id ?? payload.assigned_by_id ?? "").trim(),
    entityType: String(payload.entity_type ?? "lead").toLowerCase() === "deal" ? "deal" : "lead",
    entityId: String(payload.entity_id ?? payload.deal_id ?? payload.lead_id ?? "").trim()
  };
}

export function validateEvent(event) {
  const errors = [];
  if (!event.callId) errors.push("Не передан ID звонка Скорозвона");
  if (event.clientPhone.length !== 11) errors.push("Некорректный номер клиента");
  if (event.successfulCallerId.length !== 11) errors.push("Не передан номер успешного дозвона");
  return errors;
}

export function parseLineMap(raw) {
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return Object.fromEntries(
    Object.entries(parsed).map(([phone, lineId]) => [normalizePhone(phone), String(lineId)])
  );
}

export function assertAllowedCallerId(callerId, allowListRaw) {
  if (!allowListRaw) return;
  const allowed = new Set(allowListRaw.split(",").map(normalizePhone).filter(Boolean));
  if (!allowed.has(normalizePhone(callerId))) {
    throw new Error("Номер отсутствует в разрешённой корпоративной карусели");
  }
}

export function buildCrmFields(event, lineId = "", options = {}) {
  const fields = {
    TITLE: `Актуализированный лид ${event.clientPhone}`,
    PHONE: [{ VALUE: `+${event.clientPhone}`, VALUE_TYPE: "WORK" }],
    UF_CRM_CLIENT_PHONE: event.clientPhone,
    UF_CRM_SUCCESS_CALLER_ID: event.successfulCallerId,
    UF_CRM_SUCCESS_LINE_ID: lineId,
    UF_CRM_SKOROZVON_CALL_ID: event.callId,
    UF_CRM_ACTUALIZER: event.actualizer
  };

  if (event.entityType === "lead") {
    fields.STATUS_ID = options.leadStatusId || "NEW";
  }
  if (options.assignedById) {
    fields.ASSIGNED_BY_ID = String(options.assignedById);
  }
  return fields;
}
