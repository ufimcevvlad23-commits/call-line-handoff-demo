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
const SESSION_ID_KEYS = ["session_id", "sessionId", "sip_session_id", "sipSessionId"];
const EXTERNAL_ACCESS_KEYS = ["external_access_id", "externalAccessId", "external_id"];

export const DEFAULT_FIELD_MAP = Object.freeze({
  clientPhone: "UF_CRM_CLIENT_PHONE",
  successfulCallerId: "UF_CRM_SUCCESS_CALLER_ID",
  successLineId: "UF_CRM_SUCCESS_LINE_ID",
  skorozvonCallId: "UF_CRM_SKOROZVON_CALL_ID",
  actualizer: "UF_CRM_ACTUALIZER",
  callLink: "UF_CRM_CALL_LINK",
  handoffStatus: "UF_CRM_SKZ_STATUS",
  sessionId: "UF_CRM_SKZ_SESSION_ID",
  externalAccessId: "UF_CRM_SKZ_EXTERNAL_ACCESS_ID",
  lastError: "UF_CRM_SKZ_LAST_ERROR"
});

export function getFieldMap(env = process.env) {
  return {
    clientPhone: env.BITRIX_FIELD_CLIENT_PHONE || DEFAULT_FIELD_MAP.clientPhone,
    successfulCallerId: env.BITRIX_FIELD_SUCCESS_CALLER_ID || DEFAULT_FIELD_MAP.successfulCallerId,
    successLineId: env.BITRIX_FIELD_SUCCESS_LINE_ID || DEFAULT_FIELD_MAP.successLineId,
    skorozvonCallId: env.BITRIX_FIELD_SKOROZVON_CALL_ID || DEFAULT_FIELD_MAP.skorozvonCallId,
    actualizer: env.BITRIX_FIELD_ACTUALIZER || DEFAULT_FIELD_MAP.actualizer,
    callLink: env.BITRIX_FIELD_CALL_LINK || DEFAULT_FIELD_MAP.callLink,
    handoffStatus: env.BITRIX_FIELD_HANDOFF_STATUS || DEFAULT_FIELD_MAP.handoffStatus,
    sessionId: env.BITRIX_FIELD_SESSION_ID || DEFAULT_FIELD_MAP.sessionId,
    externalAccessId: env.BITRIX_FIELD_EXTERNAL_ACCESS_ID || DEFAULT_FIELD_MAP.externalAccessId,
    lastError: env.BITRIX_FIELD_LAST_ERROR || DEFAULT_FIELD_MAP.lastError
  };
}

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
    sessionId: String(firstValue(payload, SESSION_ID_KEYS) ?? "").trim(),
    externalAccessId: String(firstValue(payload, EXTERNAL_ACCESS_KEYS) ?? "").trim(),
    clientPhone: normalizePhone(firstValue(payload, PHONE_KEYS)),
    successfulCallerId: normalizePhone(firstValue(payload, CALLER_KEYS)),
    result: String(payload.result ?? payload.status ?? "qualified").trim(),
    actualizer: String(payload.actualizer ?? payload.operator_name ?? "").trim(),
    actualizerId: String(payload.actualizer_id ?? payload.operator_id ?? payload.user_id ?? "").trim(),
    managerId: String(payload.manager_id ?? payload.assigned_by_id ?? "").trim(),
    entityType: String(payload.entity_type ?? "lead").toLowerCase() === "deal" ? "deal" : "lead",
    entityId: String(payload.entity_id ?? payload.deal_id ?? payload.lead_id ?? "").trim(),
    startedAt: String(payload.started_at ?? payload.startedAt ?? "").trim(),
    connectedAt: String(payload.connected_at ?? payload.connectedAt ?? "").trim(),
    source: String(payload.source ?? "skorozvon_form").trim()
  };
}

export function validateEvent(event) {
  const errors = [];
  if (!event.callId) errors.push("Не передан ID звонка Скорозвона");
  if (event.clientPhone.length !== 11) errors.push("Некорректный номер клиента");
  if (event.successfulCallerId && event.successfulCallerId.length !== 11) errors.push("Некорректный номер успешного дозвона");
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
  if (!allowListRaw) throw new Error("Белый список корпоративных номеров ещё не настроен");
  const allowed = new Set(allowListRaw.split(",").map(normalizePhone).filter(Boolean));
  if (!allowed.has(normalizePhone(callerId))) {
    throw new Error("Номер отсутствует в разрешённой корпоративной карусели");
  }
}

export function isAllowedCallerId(callerId, allowListRaw) {
  if (!callerId || !allowListRaw) return false;
  const allowed = new Set(allowListRaw.split(",").map(normalizePhone).filter(Boolean));
  return allowed.has(normalizePhone(callerId));
}

export function handoffStatusLabel(state) {
  return ({
    observed: "Звонок найден в Скорозвоне; заявка ещё не передана",
    waiting_caller_id: "Ожидает определения исходящего номера",
    caller_unverified: "Исходящий номер ожидает подтверждения",
    ready: "Готово к звонку менеджера",
    call_requested: "Звонок менеджера запущен",
    call_failed: "Ошибка запуска звонка"
  })[state] || state;
}

export function buildCrmFields(event, lineId = "", options = {}) {
  const fieldMap = options.fieldMap || DEFAULT_FIELD_MAP;
  const fields = {
    TITLE: `Актуализированный лид ${event.clientPhone}`,
    PHONE: [{ VALUE: `+${event.clientPhone}`, VALUE_TYPE: "WORK" }],
    [fieldMap.clientPhone]: event.clientPhone,
    [fieldMap.successfulCallerId]: event.successfulCallerId,
    [fieldMap.successLineId]: lineId,
    [fieldMap.skorozvonCallId]: event.callId,
    [fieldMap.actualizer]: event.actualizer
  };

  if (fieldMap.handoffStatus) fields[fieldMap.handoffStatus] = options.handoffStatus || "Ожидает определения исходящего номера";
  if (fieldMap.sessionId) fields[fieldMap.sessionId] = event.sessionId || "";
  if (fieldMap.externalAccessId) fields[fieldMap.externalAccessId] = event.externalAccessId || "";
  if (fieldMap.lastError) fields[fieldMap.lastError] = options.lastError || "";

  if (event.entityType === "lead") {
    fields.STATUS_ID = options.leadStatusId || "NEW";
  }
  if (options.assignedById) {
    fields.ASSIGNED_BY_ID = String(options.assignedById);
  }
  return fields;
}
