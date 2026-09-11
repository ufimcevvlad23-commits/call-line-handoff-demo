import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const [overlayPath, accessPath] = process.argv.slice(2);
if (!overlayPath || !accessPath) throw new Error("Usage: node deploy/bootstrap-sip-secrets.mjs <overlay-env> <access-json>");

const publicIp = String(process.env.SIP_PUBLIC_IP || "");
if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(publicIp)) throw new Error("SIP_PUBLIC_IP обязателен");
const secret = (current) => current || randomBytes(32).toString("base64url");
const skorozvonUser = process.env.SKOROZVON_SIP_USERNAME || "skorozvon-callbridge";
const managerUser = process.env.MANAGER_SIP_USERNAME || "vlad-56435";
const skorozvonPassword = secret(process.env.SKOROZVON_SIP_PASSWORD);
const managerPassword = secret(process.env.MANAGER_SIP_PASSWORD);

const overlay = [
  `SIP_PUBLIC_IP=${publicIp}`,
  "SIP_PROVIDER_PORT=5060",
  "SIP_USER_PORT=5070",
  "BEELINE_SIP_HOST=voip.beeline.ru",
  "BEELINE_SIP_PORT=5060",
  "BEELINE_SIGNALING_IPS=62.105.135.81,62.105.132.84",
  `SKOROZVON_SIP_USERNAME=${skorozvonUser}`,
  `SKOROZVON_SIP_PASSWORD=${skorozvonPassword}`,
  `MANAGER_SIP_USERNAME=${managerUser}`,
  `MANAGER_SIP_PASSWORD=${managerPassword}`,
  `ASTERISK_MANAGER_CHANNEL=PJSIP/${managerUser}`,
  "AUTO_TRUST_ANSWERED_CALLER_IDS=true",
  "DEFAULT_TRUNK_ENDPOINT=beeline-trunk-1",
  "CALLING_ENABLED=false"
].join("\n") + "\n";

const access = {
  server: publicIp,
  protocol: "SIP/UDP",
  port: 5070,
  realm: publicIp,
  skorozvon: { username: skorozvonUser, password: skorozvonPassword },
  manager: { name: "Уфимцев Владислав", username: managerUser, password: managerPassword },
  note: "Прямой исходящий набор с manager endpoint отключён; звонок клиенту запускается подписанной кнопкой Bitrix."
};

await writeFile(overlayPath, overlay, { encoding: "utf8", mode: 0o600 });
await writeFile(accessPath, JSON.stringify(access, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ ok: true, overlayPath, accessPath, callingEnabled: false }));
