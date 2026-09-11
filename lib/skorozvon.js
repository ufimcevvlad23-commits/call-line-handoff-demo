import { normalizePhone } from "./calls.js";

let tokenCache = { token: "", expiresAt: 0 };

function configured(env = process.env) {
  return Boolean(env.SKOROZVON_API_LOGIN && env.SKOROZVON_API_KEY && env.SKOROZVON_CLIENT_ID && env.SKOROZVON_CLIENT_SECRET);
}

async function getToken(env = process.env) {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  if (!configured(env)) throw new Error("Учётные данные API Скорозвона не настроены");
  const body = new URLSearchParams({
    grant_type: "password",
    username: env.SKOROZVON_API_LOGIN,
    api_key: env.SKOROZVON_API_KEY,
    client_id: env.SKOROZVON_CLIENT_ID,
    client_secret: env.SKOROZVON_CLIENT_SECRET
  });
  const response = await fetch("https://api.skorozvon.ru/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(Number(env.UPSTREAM_TIMEOUT_MS || 12_000))
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || `Скорозвон OAuth HTTP ${response.status}`);
  tokenCache = {
    token: String(data.access_token),
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000
  };
  return tokenCache.token;
}

function itemsFromResponse(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["data", "items", "results", "records"]) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

export function normalizeSkorozvonCall(call) {
  const params = typeof call?.params === "object" && call.params ? call.params : {};
  return {
    callId: String(call?.id || call?.call_id || ""),
    sessionId: String(call?.session_id || params.session_id || ""),
    externalAccessId: String(call?.external_access_id || params.external_access_id || ""),
    clientPhone: normalizePhone(call?.phone || call?.to_number || params.phone),
    successfulCallerId: "",
    actualizer: String(call?.user_name || call?.operator_name || ""),
    actualizerId: String(call?.user_id || call?.operator_id || ""),
    result: String(call?.result || call?.status || "connected"),
    entityType: "lead",
    startedAt: String(call?.started_at || call?.created_at || ""),
    connectedAt: String(call?.connected_at || ""),
    source: "skorozvon_poll"
  };
}

export async function fetchRecentConnectedCalls(env = process.env) {
  const token = await getToken(env);
  const length = Math.min(500, Math.max(20, Number(env.SKOROZVON_PAGE_LENGTH || 100)));
  const response = await fetch(`https://api.skorozvon.ru/api/v2/calls?page=1&length=${length}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(Number(env.UPSTREAM_TIMEOUT_MS || 12_000))
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || `Скорозвон HTTP ${response.status}`);
  return itemsFromResponse(data)
    .filter((call) => String(call.direction || "out").toLowerCase() !== "in" && Boolean(call.connected_at))
    .map(normalizeSkorozvonCall)
    .filter((call) => call.callId && call.clientPhone.length === 11);
}

export function isSkorozvonConfigured(env = process.env) {
  return configured(env);
}
