import { spawnSync } from "node:child_process";
import { normalizePhone, parseLineMap } from "../lib/calls.js";

const apply = process.argv.includes("--apply");
const allowed = new Set(String(process.env.ALLOWED_CALLER_IDS || "").split(",").map(normalizePhone).filter(Boolean));
const lineMap = parseLineMap(process.env.LINE_MAP_JSON);
const desired = Object.entries(lineMap).filter(([phone]) => allowed.has(phone));

if (!desired.length) throw new Error("Белый список и карта SIP-линий пусты; синхронизация заблокирована");
for (const [phone, endpoint] of desired) {
  if (!/^7\d{10}$/.test(phone)) throw new Error(`Некорректный корпоративный номер: ${phone}`);
  if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(endpoint)) throw new Error(`Некорректный endpoint для ${phone}`);
}

if (!apply) {
  console.log(JSON.stringify({ ok: true, dryRun: true, allowedNumbers: desired.length }));
  process.exit(0);
}

function asterisk(command) {
  const result = spawnSync("/usr/sbin/asterisk", ["-rx", command], { encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Asterisk exit ${result.status}`);
  return result.stdout;
}

const existingOutput = asterisk("database show callbridge-caller-route");
const existing = new Set(Array.from(existingOutput.matchAll(/^\/callbridge-caller-route\/(7\d{10})\s*:/gm), (match) => match[1]));
for (const phone of existing) {
  if (!desired.some(([allowedPhone]) => allowedPhone === phone)) asterisk(`database del callbridge-caller-route ${phone}`);
}
for (const [phone, endpoint] of desired) asterisk(`database put callbridge-caller-route ${phone} ${endpoint}`);
console.log(JSON.stringify({ ok: true, dryRun: false, allowedNumbers: desired.length, removedStale: [...existing].filter((phone) => !allowed.has(phone)).length }));
