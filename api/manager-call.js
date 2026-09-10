import { randomBytes } from "node:crypto";
import { getCrmEntity } from "../lib/bitrix.js";
import { getFieldMap, normalizePhone } from "../lib/calls.js";
import { verifyEntitySignature } from "../lib/signing.js";

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
  const nonce = randomBytes(16).toString("base64");
  const enabled = process.env.CALL_BRIDGE_ENABLED === "true";
  const payload = JSON.stringify({ entityType, entityId, signature });

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'`);
  res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Звонок по лиду</title><style>body{font-family:system-ui;background:#0b1020;color:#fff;margin:0;padding:32px}.card{max-width:560px;margin:auto;background:#151d31;border:1px solid #2b3856;border-radius:18px;padding:24px}p{color:#b7c2d8}button{width:100%;padding:14px;border:0;border-radius:10px;background:#377df7;color:#fff;font-weight:700}button:disabled{opacity:.45}pre{white-space:pre-wrap;background:#080c16;padding:12px;border-radius:10px}</style><div class="card"><h1>Звонок по лиду #${escapeHtml(entityId)}</h1><p>Клиент: +${escapeHtml(clientPhone)}</p><p>Исходящий номер: +${escapeHtml(callerId)}</p><button id="call" ${enabled ? "" : "disabled"}>Позвонить с того же номера</button><p>${enabled ? "Перед запуском проверьте номер клиента." : "Звонки временно отключены до настройки SIP-линий."}</p><pre id="result"></pre></div><script nonce="${nonce}">const button=document.getElementById('call');button.addEventListener('click',async()=>{button.disabled=true;const response=await fetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${payload})});const data=await response.json();document.getElementById('result').textContent=data.ok?'Звонок запущен':(data.error||'Ошибка');});</script></html>`);
}
