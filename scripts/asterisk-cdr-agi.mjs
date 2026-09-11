#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  return digits;
}

async function consumeAgiEnvironment() {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  await new Promise((resolve) => {
    input.on("line", (line) => {
      if (!line) {
        input.close();
        resolve();
      }
    });
    input.on("close", resolve);
  });
}

function parseEnv(text) {
  return Object.fromEntries(String(text).split(/\r?\n/).flatMap((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#") || !clean.includes("=")) return [];
    const index = clean.indexOf("=");
    return [[clean.slice(0, index), clean.slice(index + 1)]];
  }));
}

await consumeAgiEnvironment();
const [eventId, callId, sessionId, clientRaw, callerRaw, dispositionRaw] = process.argv.slice(2);
const clientPhone = normalizePhone(clientRaw);
const callerId = normalizePhone(callerRaw);
const disposition = String(dispositionRaw || "").toUpperCase();
if (!eventId || clientPhone.length !== 11 || callerId.length !== 11 || !disposition) process.exit(0);

try {
  const configPath = process.env.CALLBRIDGE_CDR_ENV || "/etc/asterisk/callbridge-cdr.env";
  const config = parseEnv(await readFile(configPath, "utf8"));
  if (!config.PBX_CDR_SECRET) throw new Error("PBX_CDR_SECRET отсутствует");
  const response = await fetch(config.CALLBRIDGE_CDR_URL || "http://127.0.0.1:8790/api/pbx-cdr", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.PBX_CDR_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      event_id: String(eventId),
      call_id: String(callId || ""),
      session_id: String(sessionId || ""),
      client_phone: clientPhone,
      caller_id: callerId,
      disposition,
      occurred_at: new Date().toISOString()
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Call Bridge HTTP ${response.status}`);
} catch (error) {
  console.error(`Call Bridge CDR delivery failed: ${error.message}`);
  process.exitCode = 1;
}
