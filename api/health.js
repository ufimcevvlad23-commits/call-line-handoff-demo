import { json } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Используйте GET" });
  return json(res, 200, {
    ok: true,
    service: "skorozvon-bitrix-call-bridge",
    mode: process.env.BITRIX24_WEBHOOK_URL ? "live" : "demo",
    ingestionEnabled: process.env.CALL_BRIDGE_ENABLED === "true",
    callingEnabled: Boolean(process.env.LINE_MAP_JSON && process.env.LINE_MAP_JSON !== "{}")
  });
}
