import { randomBytes } from "node:crypto";
import { getCrmEntity } from "../lib/bitrix.js";
import { getFieldMap, normalizePhone, parseLineMap, isAllowedCallerId } from "../lib/calls.js";
import { verifyEntitySignature } from "../lib/signing.js";
import { getStore } from "../lib/store.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Используйте GET");
  }

  const url = new URL(req.url, process.env.PUBLIC_BASE_URL || "http://localhost");
  const entityType = url.searchParams.get("entityType") === "deal" ? "deal" : "lead";
  const entityId = url.searchParams.get("entityId") || "";
  const signature = url.searchParams.get("signature") || "";
  if (!verifyEntitySignature(entityType, entityId, signature, process.env.MANAGER_ACTION_SECRET)) {
    res.statusCode = 403;
    return res.end("Ссылка недействительна");
  }

  const fieldMap = getFieldMap();
  const entity = await getCrmEntity(entityType, entityId);
  const clientPhone = normalizePhone(entity[fieldMap.clientPhone] || entity.PHONE?.[0]?.VALUE);
  const callerId = normalizePhone(entity[fieldMap.successfulCallerId]);
  const handoffStatus = String(entity[fieldMap.handoffStatus] || "Ожидает определения исходящего номера");
  const nonce = randomBytes(16).toString("base64");
  const lineMap = parseLineMap(process.env.LINE_MAP_JSON);
  const verifiedCaller = getStore().getVerifiedCallerId(callerId);
  const callerAllowed = isAllowedCallerId(callerId, process.env.ALLOWED_CALLER_IDS) || Boolean(verifiedCaller);
  const lineAvailable = Boolean(lineMap[callerId] || verifiedCaller?.line_id);
  const managerChannelConfigured = Boolean(String(process.env.ASTERISK_MANAGER_CHANNEL || "").trim());
  const callingEnabled = process.env.CALLING_ENABLED === "true";
  const enabled = callingEnabled && managerChannelConfigured && callerAllowed && lineAvailable;
  let actionHint = "После ответа в Битриксе нажмите 1. Только после этого система позвонит клиенту.";
  if (!enabled && (!callerId || !callerAllowed || !lineAvailable)) {
    actionHint = "Кнопка включится после определения и подтверждения исходящего номера.";
  } else if (!enabled && !managerChannelConfigured) {
    actionHint = "Лид готов. Осталось указать телефон или SIP-аккаунт менеджера.";
  } else if (!enabled && !callingEnabled) {
    actionHint = "Лид готов. Реальные вызовы включатся после регистрации телефона менеджера.";
  }
  const payload = JSON.stringify({ entityType, entityId, signature });

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'`);
  res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Звонок по лиду</title><style>body{font-family:system-ui;background:#0b1020;color:#fff;margin:0;padding:32px}.card{max-width:560px;margin:auto;background:#151d31;border:1px solid #2b3856;border-radius:18px;padding:24px}p{color:#b7c2d8}.status{padding:10px 12px;border-radius:10px;background:#202b43;color:#d6e1f5}button{width:100%;padding:14px;border:0;border-radius:10px;background:#377df7;color:#fff;font-weight:700}button:disabled{opacity:.45}pre{white-space:pre-wrap;background:#080c16;padding:12px;border-radius:10px}</style><div class="card"><h1>Звонок по лиду #${escapeHtml(entityId)}</h1><p class="status">${escapeHtml(handoffStatus)}</p><p>Клиент: ${clientPhone ? `+${escapeHtml(clientPhone)}` : "не указан"}</p><p>Исходящий номер: ${callerId ? `+${escapeHtml(callerId)}` : "ещё определяется"}</p><button id="call" ${enabled ? "" : "disabled"}>Позвонить с того же номера</button><p>${escapeHtml(actionHint)}</p><pre id="result"></pre></div><script nonce="${nonce}">const button=document.getElementById('call');button.addEventListener('click',async()=>{button.disabled=true;const response=await fetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${payload})});const data=await response.json();document.getElementById('result').textContent=data.ok?'Ответьте в Битриксе и нажмите 1':(data.error||'Ошибка');});</script></html>`);
}
