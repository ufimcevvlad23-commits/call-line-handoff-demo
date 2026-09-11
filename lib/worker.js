import { fetchRecentConnectedCalls, isSkorozvonConfigured } from "./skorozvon.js";
import { processPendingCrm, reconcileCallerAllowlist, reconcileUnmatchedCdr } from "./pipeline.js";

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
    for (const event of calls) {
      const result = store.upsertCall(event, { qualified: false, state: "observed" });
      if (result.created) {
        observed += 1;
        store.audit("skorozvon_call_observed", event.callId, { connectedAt: event.connectedAt });
      }
    }
    store.setIntegrationState("skorozvon", { status: "connected", received: calls.length, new: observed });
    return { observed };
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
