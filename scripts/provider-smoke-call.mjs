import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

const confirmation = String(process.env.ALLOW_PROVIDER_SMOKE_CALL || "");
const clientPhone = String(process.env.TEST_CLIENT_PHONE || "").replace(/\D/g, "").replace(/^8/, "7");
const callerId = String(process.env.TEST_CALLER_ID || "").replace(/\D/g, "").replace(/^8/, "7");
const trunk = String(process.env.TEST_TRUNK_ENDPOINT || "beeline-trunk-1");
const host = String(process.env.ASTERISK_AMI_HOST || "127.0.0.1");
const port = Number(process.env.ASTERISK_AMI_PORT || 5038);
const username = String(process.env.ASTERISK_AMI_USERNAME || "");
const secret = String(process.env.ASTERISK_AMI_SECRET || "");

if (confirmation !== "I_UNDERSTAND") throw new Error("Установите ALLOW_PROVIDER_SMOKE_CALL=I_UNDERSTAND");
if (!/^7\d{10}$/.test(clientPhone)) throw new Error("TEST_CLIENT_PHONE должен быть российским номером");
if (!/^7\d{10}$/.test(callerId)) throw new Error("TEST_CALLER_ID должен быть российским номером");
if (!/^[a-zA-Z0-9_.-]{3,80}$/.test(trunk)) throw new Error("Некорректный TEST_TRUNK_ENDPOINT");
if (!username || !secret || !Number.isInteger(port)) throw new Error("AMI не настроен");

function frame(fields) {
  return `${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`;
}

const actionId = `provider-smoke-${randomUUID()}`;
const result = await new Promise((resolve, reject) => {
  const socket = createConnection({ host, port });
  let buffer = "";
  const timer = setTimeout(() => socket.destroy(new Error("Тайм-аут Asterisk AMI")), 10_000);
  socket.setEncoding("utf8");
  socket.on("connect", () => {
    socket.write(frame({ Action: "Login", Username: username, Secret: secret, Events: "off" }));
    socket.write(frame({
      Action: "Originate",
      ActionID: actionId,
      Channel: `PJSIP/${clientPhone}@${trunk}`,
      CallerID: callerId,
      Application: "Wait",
      Data: "5",
      Timeout: "15000",
      Async: "true"
    }));
    socket.write(frame({ Action: "Logoff" }));
  });
  socket.on("data", (chunk) => { buffer += chunk; });
  socket.on("error", (error) => { clearTimeout(timer); reject(error); });
  socket.on("close", () => {
    clearTimeout(timer);
    const errorMessage = buffer.match(/Response: Error\r\nMessage: ([^\r\n]+)/i)?.[1];
    if (errorMessage) return reject(new Error(errorMessage));
    if (!buffer.includes(actionId) && !/Response: Success/i.test(buffer)) return reject(new Error("Asterisk не принял smoke-тест"));
    resolve({ ok: true, accepted: true, actionId, clientPhoneMasked: `+7 *** ***-${clientPhone.slice(-2)}`, callerIdMasked: `+7 *** ***-${callerId.slice(-2)}` });
  });
});

console.log(JSON.stringify(result, null, 2));
