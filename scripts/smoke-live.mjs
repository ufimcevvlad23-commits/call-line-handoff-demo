const baseUrl = String(process.env.LOCAL_SERVICE_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
const clientPhone = String(process.env.TEST_CLIENT_PHONE || "").replace(/\D/g, "").replace(/^8/, "7");
const runId = String(process.env.SMOKE_TEST_RUN_ID || "v1").trim();
if (clientPhone.length !== 11) throw new Error("TEST_CLIENT_PHONE не настроен");
if (!/^[a-zA-Z0-9_-]{1,48}$/.test(runId)) throw new Error("SMOKE_TEST_RUN_ID содержит недопустимые символы");
if (!process.env.SKOROZVON_WEBHOOK_SECRET || !process.env.DASHBOARD_ACCESS_TOKEN) throw new Error("Не настроены smoke-test секреты");

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(15_000) });
  const data = await response.json();
  return { status: response.status, data };
}

const payload = {
  call_id: `bridge-installation-test-${runId}`,
  session_id: `bridge-installation-session-${runId}`,
  external_access_id: `bridge-installation-external-${runId}`,
  client_phone: clientPhone,
  entity_type: "lead",
  result: "qualified",
  actualizer: "Тест интеграции"
};
const headers = { Authorization: `Bearer ${process.env.SKOROZVON_WEBHOOK_SECRET}`, "Content-Type": "application/json" };
const first = await request("/api/skorozvon-event", { method: "POST", headers, body: JSON.stringify(payload) });
if (![200, 202].includes(first.status) || !first.data.ok) throw new Error(`CRM smoke test failed: ${first.status} ${first.data.error || ""}`);
const duplicate = await request("/api/skorozvon-event", { method: "POST", headers, body: JSON.stringify(payload) });
if (!duplicate.data.deduplicated) throw new Error("Повторная форма не была распознана как дубль");
const dashboard = await request("/api/admin/summary", { headers: { Authorization: `Bearer ${process.env.DASHBOARD_ACCESS_TOKEN}` } });
if (dashboard.status !== 200 || !dashboard.data.ok) throw new Error("Операционная панель недоступна");
const blockedCall = await request("/api/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
if (blockedCall.status !== 503) throw new Error(`Предохранитель звонков не сработал: HTTP ${blockedCall.status}`);
console.log(JSON.stringify({
  ok: true,
  entity: first.data.entity,
  state: first.data.state,
  deduplicated: duplicate.data.deduplicated,
  dashboardCalls: dashboard.data.metrics.observedCalls,
  callingBlocked: true
}, null, 2));
