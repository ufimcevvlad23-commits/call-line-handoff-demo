import { json } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Используйте GET" });
  const ingestionEnabled = process.env.INGESTION_ENABLED === "true" || process.env.CALL_BRIDGE_ENABLED === "true";
  const callingEnabled = process.env.CALLING_ENABLED === "true";
  return json(res, 200, {
    ok: true,
    service: "skorozvon-bitrix-call-bridge",
    mode: process.env.BITRIX24_WEBHOOK_URL ? "live" : "demo",
    ingestionEnabled,
    cdrEnabled: process.env.PBX_CDR_ENABLED === "true",
    callingEnabled,
    sipStatus: callingEnabled ? "enabled" : "awaiting_provider_access"
  });
}
