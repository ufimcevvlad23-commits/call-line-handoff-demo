import { normalizePhone } from "./calls.js";

let tokenCache = { token: "", expiresAt: 0 };
let callerSourceCache = { baseUrl: "", phones: new Map(), expiresAt: 0 };

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

function normalizedInternalBaseUrl(env = process.env) {
  const raw = String(env.SKOROZVON_INTERNAL_BASE_URL || "").trim();
  if (!raw) return "";
  const url = new URL(raw);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".skorozvon.ru")) {
    throw new Error("SKOROZVON_INTERNAL_BASE_URL должен указывать на HTTPS-хост *.skorozvon.ru");
  }
  return url.origin;
}

export function buildCallerSourcePhoneMap(...payloads) {
  const phones = new Map();
  const add = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      const sourceId = String(item?.uuid || "").trim();
      const phone = normalizePhone(item?.phone);
      if (sourceId && phone.length === 11) phones.set(sourceId, phone);
    }
  };
  for (const payload of payloads) {
    const data = payload?.data ?? payload;
    if (Array.isArray(data)) add(data);
    else {
      add(data?.caller_numbers);
      add(data?.sip_registrations);
    }
  }
  return phones;
}

async function fetchCallerSourcePhones(token, env = process.env) {
  const baseUrl = normalizedInternalBaseUrl(env);
  if (!baseUrl) return new Map();
  if (callerSourceCache.baseUrl === baseUrl && callerSourceCache.expiresAt > Date.now()) {
    return callerSourceCache.phones;
  }
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const payloads = [];
  for (const path of ["/sip_registrations", "/resurgent/caller_sources"]) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(Number(env.UPSTREAM_TIMEOUT_MS || 12_000))
      });
      if (response.ok) payloads.push(await response.json());
    } catch {
      // Caller source resolution is optional; normal call ingestion must continue.
    }
  }
  const phones = buildCallerSourcePhoneMap(...payloads);
  callerSourceCache = { baseUrl, phones, expiresAt: Date.now() + 5 * 60_000 };
  return phones;
}

export function normalizeSkorozvonCall(call, callerSourcePhones = new Map()) {
  const params = typeof call?.params === "object" && call.params ? call.params : {};
  const directSourcePhone = normalizePhone(call?.source_phone || call?.from_phone || params.source_phone);
  const sourcePhone = directSourcePhone.length === 11
    ? directSourcePhone
    : callerSourcePhones.get(String(call?.source || "")) || "";
  return {
    callId: String(call?.id || call?.call_id || ""),
    sessionId: String(call?.session_id || params.session_id || ""),
    externalAccessId: String(call?.external_access_id || params.external_access_id || ""),
    clientPhone: normalizePhone(call?.phone || call?.to_number || params.phone),
    successfulCallerId: sourcePhone,
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
  const callerSourcePhones = await fetchCallerSourcePhones(token, env);
  const length = Math.min(500, Math.max(20, Number(env.SKOROZVON_PAGE_LENGTH || 100)));
  const response = await fetch(`https://api.skorozvon.ru/api/v2/calls?page=1&length=${length}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(Number(env.UPSTREAM_TIMEOUT_MS || 12_000))
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || `Скорозвон HTTP ${response.status}`);
  return itemsFromResponse(data)
    .filter((call) => String(call.direction || "out").toLowerCase() !== "in" && Boolean(call.connected_at))
    .map((call) => normalizeSkorozvonCall(call, callerSourcePhones))
    .filter((call) => call.callId && call.clientPhone.length === 11);
}

export function isSkorozvonConfigured(env = process.env) {
  return configured(env);
}
