import { isAuthorized, json } from "../lib/http.js";
import { getStore } from "../lib/store.js";

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? `+7 *** ***-${digits.slice(-4, -2)}-${digits.slice(-2)}` : "—";
}

function cleanAudit(row) {
  let details = {};
  try { details = JSON.parse(row.details || "{}"); } catch { /* ignore malformed legacy details */ }
  return {
    eventType: row.event_type,
    entityId: row.entity_id || "",
    details: {
      state: details.state,
      entityType: details.entityType,
      crmEntityId: details.entityId,
      error: details.error ? String(details.error).slice(0, 240) : undefined
    },
    createdAt: row.created_at
  };
}

function cleanIntegrations(integrations) {
  return Object.fromEntries(Object.entries(integrations).map(([key, item]) => {
    let value = {};
    try { value = JSON.parse(item.value || "{}"); } catch { value = { status: item.value || "unknown" }; }
    return [key, { status: String(value.status || "unknown"), updatedAt: item.updatedAt }];
  }));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Используйте GET" });
  if (!process.env.DASHBOARD_ACCESS_TOKEN) return json(res, 503, { ok: false, error: "Код доступа к панели ещё не настроен" });
  if (!isAuthorized(req, process.env.DASHBOARD_ACCESS_TOKEN)) return json(res, 401, { ok: false, error: "Неверный код доступа" });
  const url = new URL(req.url, "http://localhost");
  const state = String(url.searchParams.get("state") || "");
  const allowedStates = new Set(["", "observed", "waiting_caller_id", "caller_unverified", "ready", "call_requested", "call_failed"]);
  if (!allowedStates.has(state)) return json(res, 400, { ok: false, error: "Некорректный фильтр состояния" });
  const dashboard = getStore().dashboard({ state, limit: 50 });
  return json(res, 200, {
    ok: true,
    generatedAt: dashboard.generatedAt,
    source: { label: "Локальная операционная база Call Bridge", scope: "Последние 50 записей; телефоны замаскированы", timezone: "UTC" },
    metrics: {
      observedCalls: dashboard.total,
      qualifiedForms: dashboard.qualified,
      waitingCallerId: dashboard.counts.waiting_caller_id || 0,
      ready: dashboard.counts.ready || 0,
      crmSynced: dashboard.crmSynced,
      errors: dashboard.errors
    },
    integrations: cleanIntegrations(dashboard.integrations),
    calls: dashboard.calls.map((call) => ({
      callId: call.skorozvon_call_id,
      clientPhone: maskPhone(call.client_phone),
      callerId: maskPhone(call.successful_caller_id),
      state: call.state,
      crmSyncState: call.crm_sync_state,
      crmEntityId: call.crm_entity_id || "",
      connectedAt: call.connected_at,
      updatedAt: call.updated_at,
      retryCount: Number(call.retry_count || 0),
      error: call.last_error ? String(call.last_error).slice(0, 240) : ""
    })),
    audit: dashboard.audit.map(cleanAudit),
    flags: {
      ingestionEnabled: process.env.INGESTION_ENABLED === "true" || process.env.CALL_BRIDGE_ENABLED === "true",
      cdrEnabled: process.env.PBX_CDR_ENABLED === "true",
      callingEnabled: process.env.CALLING_ENABLED === "true",
      skorozvonPolling: process.env.SKOROZVON_POLL_ENABLED === "true"
    }
  });
}
