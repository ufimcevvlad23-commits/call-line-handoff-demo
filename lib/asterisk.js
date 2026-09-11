import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

function encodeAction(fields) {
  return `${Object.entries(fields).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((item) => `${key}: ${item}`)).join("\r\n")}\r\n\r\n`;
}

function safeAmiValue(value, label, maxLength = 256) {
  const text = String(value || "");
  if (!text || text.length > maxLength || /[\r\n]/.test(text)) throw new Error(`Некорректное значение AMI: ${label}`);
  return text;
}

export function originateManagerBridge({ managerChannel, clientPhone, callerId, callId, lineId }, env = process.env) {
  const host = env.ASTERISK_AMI_HOST || "127.0.0.1";
  const port = Number(env.ASTERISK_AMI_PORT || 5038);
  const username = env.ASTERISK_AMI_USERNAME;
  const secret = env.ASTERISK_AMI_SECRET;
  if (!username || !secret || !managerChannel) throw new Error("AMI или канал менеджера ещё не настроены");
  const safeChannel = safeAmiValue(managerChannel, "канал менеджера");
  const safeClientPhone = safeAmiValue(clientPhone, "номер клиента", 20);
  const safeCallerId = safeAmiValue(callerId, "Caller ID", 20);
  const safeCallId = safeAmiValue(callId || "unknown", "ID звонка");
  const safeLineId = safeAmiValue(lineId, "SIP-линия", 80);
  const actionId = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let buffer = "";
    const timeout = setTimeout(() => socket.destroy(new Error("Тайм-аут Asterisk AMI")), 8000);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(encodeAction({ Action: "Login", Username: username, Secret: secret, Events: "off" }));
      socket.write(encodeAction({
        Action: "Originate",
        ActionID: actionId,
        Channel: safeChannel,
        Context: env.ASTERISK_CUSTOMER_CONTEXT || "callbridge-customer",
        Exten: safeClientPhone,
        Priority: 1,
        CallerID: safeCallerId,
        Variable: [`CB_CALLER_ID=${safeCallerId}`, `CB_CALL_ID=${safeCallId}`, `CB_TRUNK_ENDPOINT=${safeLineId}`],
        Async: "true"
      }));
      socket.write(encodeAction({ Action: "Logoff" }));
    });
    socket.on("data", (chunk) => { buffer += chunk; });
    socket.on("error", (error) => { clearTimeout(timeout); reject(error); });
    socket.on("close", () => {
      clearTimeout(timeout);
      if (/Response: Error/i.test(buffer)) return reject(new Error(buffer.match(/Message: ([^\r\n]+)/i)?.[1] || "Asterisk отклонил запрос"));
      if (!buffer.includes(actionId) && !/Response: Success/i.test(buffer)) return reject(new Error("Asterisk не подтвердил запуск звонка"));
      resolve({ actionId, accepted: true });
    });
  });
}
