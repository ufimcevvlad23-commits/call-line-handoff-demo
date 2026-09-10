function endpoint(baseUrl, method) {
  return `${baseUrl.replace(/\/$/, "")}/${method}.json`;
}

export async function bitrixCall(method, params) {
  const baseUrl = process.env.BITRIX24_WEBHOOK_URL;
  if (!baseUrl) throw new Error("BITRIX24_WEBHOOK_URL не настроен");
  const response = await fetch(endpoint(baseUrl, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || `Bitrix24 HTTP ${response.status}`);
  }
  return data.result;
}

export async function upsertCrmEntity(event, fields, callIdField = "UF_CRM_SKOROZVON_CALL_ID") {
  const entity = event.entityType === "lead" ? "lead" : "deal";
  if (event.entityId) {
    await bitrixCall(`crm.${entity}.update`, { id: event.entityId, fields });
    return { entityType: entity, entityId: event.entityId, created: false };
  }

  const found = await bitrixCall(`crm.${entity}.list`, {
    filter: { [callIdField]: event.callId },
    select: ["ID"]
  });
  if (Array.isArray(found) && found[0]?.ID) {
    await bitrixCall(`crm.${entity}.update`, { id: found[0].ID, fields });
    return { entityType: entity, entityId: String(found[0].ID), created: false };
  }

  const id = await bitrixCall(`crm.${entity}.add`, { fields });
  return { entityType: entity, entityId: String(id), created: true };
}

export async function getCrmEntity(entityType, entityId) {
  const entity = entityType === "lead" ? "lead" : "deal";
  return bitrixCall(`crm.${entity}.get`, { id: entityId });
}

export async function startBitrixCallback({ lineId, clientPhone }) {
  return bitrixCall("voximplant.callback.start", {
    FROM_LINE: lineId,
    TO_NUMBER: clientPhone,
    TEXT_TO_PRONOUNCE: "Соединяем с актуализированным клиентом"
  });
}
