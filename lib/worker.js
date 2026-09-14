import { fetchRecentConnectedCalls, isSkorozvonConfigured } from "./skorozvon.js";
import { processPendingCrm, queueQualifiedEvent, reconcileCallerAllowlist, reconcileUnmatchedCdr } from "./pipeline.js";

function csvSet(value, normalize = (item) => item) {
  return new Set(String(value || "").split(",").map((item) => normalize(item.trim())).filter(Boolean));
}

export function shouldAutoQualify(event, env = process.env) {
  if (env.SKOROZVON_AUTO_QUALIFY_ENABLED !== "true") return false;
  const scenarios = csvSet(env.SKOROZVON_AUTO_QUALIFY_SCENARIO_IDS);
  const groups = csvSet(env.SKOROZVON_AUTO_QUALIFY_RESULT_GROUPS, (item) => item.toLocaleLowerCase("ru"));
  if (!scenarios.has(String(event.scenarioId || ""))) return false;
  if (!groups.has(String(event.resultGroup || "").trim().toLocaleLowerCase("ru"))) return false;
  const notBefore = Date.parse(String(env.SKOROZVON_AUTO_QUALIFY_NOT_BEFORE || ""));
  const occurredAt = Date.parse(String(event.connectedAt || event.startedAt || ""));
  return Number.isFinite(notBefore) && Number.isFinite(occurredAt) && occurredAt >= notBefore;
}

export async function runWorkerCycle(store, env = process.env) {
  reconcileUnmatchedCdr(store);
  reconcileCallerAllowlist(store);
  await processPendingCrm(store);
  if (env.SKOROZVON_POLL_ENABLED !== "true") {
    store.setIntegrationState("skorozvon", { status: isSkorozvonConfigured(env) ? "paused" : "not_configured" });
    return { observed: 0 };
  }
  try {
    const calls = await fetchRecentConnectedCalls(env);
    let observed = 0;
    let qualified = 0;
    for (const event of calls) {
      const existing = store.getCall(event.callId);
      if (!existing?.qualified && shouldAutoQualify(event, env)) {
        await queueQualifiedEvent(store, { ...event, source: "skorozvon_auto_qualify" });
        qualified += 1;
        continue;
      }
      const result = store.upsertCall(event, { qualified: false, state: existing?.state || "observed" });
      if (result.created) {
        observed += 1;
        store.audit("skorozvon_call_observed", event.callId, { connectedAt: event.connectedAt });
      }
    }
    store.setIntegrationState("skorozvon", { status: "connected", received: calls.length, new: observed, autoQualified: qualified });
    return { observed, qualified };
  } catch (error) {
    store.setIntegrationState("skorozvon", { status: "error", error: error.message });
    store.audit("skorozvon_poll_failed", "", { error: error.message });
    return { observed: 0, error: error.message };
  }
}

export function startBackgroundWorker(store, env = process.env) {
  let running = false;
  const cycle = async () => {
    if (running) return;
    running = true;
    try { await runWorkerCycle(store, env); } finally { running = false; }
  };
  void cycle();
  const interval = setInterval(cycle, Math.max(15, Number(env.WORKER_INTERVAL_SECONDS || 30)) * 1000);
  return () => clearInterval(interval);
}
