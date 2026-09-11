import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { originateManagerBridge } from "../lib/asterisk.js";

test("builds an AMI originate request without placing a real call", async () => {
  let request = "";
  const server = createServer((socket) => {
    socket.write("Asterisk Call Manager/9.0\r\n");
    socket.on("data", (chunk) => {
      request += chunk.toString();
      if (request.includes("Action: Logoff")) {
        socket.end("Response: Success\r\nMessage: Goodbye\r\n\r\n");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const result = await originateManagerBridge({
      managerChannel: "PJSIP/101",
      clientPhone: "79991234567",
      callerId: "79031112233",
      callId: "call-1",
      lineId: "beeline-trunk-1"
    }, {
      ASTERISK_AMI_HOST: "127.0.0.1",
      ASTERISK_AMI_PORT: String(address.port),
      ASTERISK_AMI_USERNAME: "test",
      ASTERISK_AMI_SECRET: "secret"
    });
    assert.equal(result.accepted, true);
    assert.match(request, /Action: Originate/);
    assert.match(request, /Channel: PJSIP\/101/);
    assert.match(request, /CB_CALLER_ID=79031112233/);
    assert.match(request, /CB_TRUNK_ENDPOINT=beeline-trunk-1/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
