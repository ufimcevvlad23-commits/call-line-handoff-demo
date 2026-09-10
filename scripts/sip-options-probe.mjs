import dgram from "node:dgram";
import { randomUUID } from "node:crypto";

const host = process.env.SIP_HOST;
const port = Number(process.env.SIP_PORT || 5060);
const localPort = Number(process.env.SIP_LOCAL_PORT || 0);
const trunk = process.env.SIP_TRUNK_NAME || "probe";
const advertisedHost = process.env.SIP_ADVERTISED_HOST || "127.0.0.1";
if (!host || !Number.isInteger(port)) throw new Error("SIP_HOST и SIP_PORT обязательны");

const socket = dgram.createSocket("udp4");
const branch = `z9hG4bK-${randomUUID().replaceAll("-", "")}`;
const tag = randomUUID().slice(0, 12);
const callId = `${randomUUID()}@callbridge`;

const response = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ ok: false, result: "timeout" }), 5000);
  socket.once("error", (error) => {
    clearTimeout(timer);
    resolve({ ok: false, result: "socket-error", error: error.code || error.message });
  });
  socket.once("message", (message, remote) => {
    clearTimeout(timer);
    const statusLine = message.toString("utf8").split(/\r?\n/, 1)[0];
    resolve({ ok: /^SIP\/2\.0 2\d\d/.test(statusLine), result: "response", statusLine, remote: `${remote.address}:${remote.port}` });
  });
  socket.bind(localPort, "0.0.0.0", () => {
    const address = socket.address();
    const request = [
      `OPTIONS sip:${host}:${port} SIP/2.0`,
      `Via: SIP/2.0/UDP ${advertisedHost}:${address.port};branch=${branch};rport`,
      `Max-Forwards: 70`,
      `From: <sip:${trunk}@${advertisedHost}>;tag=${tag}`,
      `To: <sip:${trunk}@${host}>`,
      `Call-ID: ${callId}`,
      `CSeq: 1 OPTIONS`,
      `Contact: <sip:${trunk}@${advertisedHost}:${address.port}>`,
      `User-Agent: call-bridge-readiness-probe`,
      `Accept: application/sdp`,
      `Content-Length: 0`,
      "",
      ""
    ].join("\r\n");
    socket.send(Buffer.from(request), port, host);
  });
});

socket.close();
console.log(JSON.stringify(response));
