import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [skorozvonPath, overlayPath, accessPath] = process.argv.slice(2);
if (!skorozvonPath || !overlayPath || !accessPath) {
  throw new Error("Usage: node deploy/build-server-overlay.mjs <skorozvon-env> <overlay-env> <access-json>");
}
const skorozvon = await readFile(skorozvonPath, "utf8");
for (const key of ["SKOROZVON_API_LOGIN", "SKOROZVON_API_KEY", "SKOROZVON_CLIENT_ID", "SKOROZVON_CLIENT_SECRET"]) {
  if (!new RegExp(`^${key}=.+$`, "m").test(skorozvon)) throw new Error(`Не найден ${key}`);
}
const dashboardToken = randomBytes(18).toString("base64url");
const cdrSecret = randomBytes(32).toString("base64url");
const amiSecret = randomBytes(32).toString("base64url");
const overlay = [
  "DATABASE_PATH=/var/lib/skorozvon-call-bridge/bridge.sqlite",
  "INGESTION_ENABLED=true",
  "PBX_CDR_ENABLED=true",
  "CALLING_ENABLED=false",
  "SKOROZVON_POLL_ENABLED=true",
  "SKOROZVON_PAGE_LENGTH=100",
  "WORKER_INTERVAL_SECONDS=30",
  "UPSTREAM_TIMEOUT_MS=12000",
  `DASHBOARD_ACCESS_TOKEN=${dashboardToken}`,
  `PBX_CDR_SECRET=${cdrSecret}`,
  `ASTERISK_AMI_SECRET=${amiSecret}`,
  "ASTERISK_AMI_HOST=127.0.0.1",
  "ASTERISK_AMI_PORT=5038",
  "ASTERISK_AMI_USERNAME=callbridge",
  "ASTERISK_MANAGER_CHANNEL=",
  "ASTERISK_CUSTOMER_CONTEXT=callbridge-customer",
  "ALLOWED_CALLER_IDS=",
  "LINE_MAP_JSON={}",
  "TEST_CLIENT_PHONE=79883878417",
  "BITRIX_FIELD_HANDOFF_STATUS=UF_CRM_SKZ_STATUS",
  "BITRIX_FIELD_SESSION_ID=UF_CRM_SKZ_SESSION_ID",
  "BITRIX_FIELD_EXTERNAL_ACCESS_ID=UF_CRM_SKZ_EXTERNAL_ACCESS_ID",
  "BITRIX_FIELD_LAST_ERROR=UF_CRM_SKZ_LAST_ERROR",
  skorozvon.trim()
].join("\n") + "\n";
await writeFile(overlayPath, overlay, { encoding: "utf8", mode: 0o600 });
await writeFile(accessPath, JSON.stringify({ dashboardToken }, null, 2), { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ ok: true, overlayPath, accessPath }));
