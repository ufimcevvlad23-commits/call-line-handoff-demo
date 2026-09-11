import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Asterisk AGI sends a protected normalized CDR to the local bridge", async () => {
  let received;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    received = { authorization: req.headers.authorization, body: JSON.parse(raw) };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(join(tmpdir(), "callbridge-agi-"));
  const configPath = join(directory, "cdr.env");
  await writeFile(configPath, `CALLBRIDGE_CDR_URL=http://127.0.0.1:${server.address().port}/cdr\nPBX_CDR_SECRET=test-cdr-secret\n`);
  try {
    const child = spawn(process.execPath, [
      "scripts/asterisk-cdr-agi.mjs",
      "pbx-1",
      "call-1",
      "session-1",
      "8 (999) 123-45-67",
      "+7 903 111-22-33",
      "ANSWERED"
    ], { cwd: process.cwd(), env: { ...process.env, CALLBRIDGE_CDR_ENV: configPath }, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end("agi_request: callbridge-cdr-agi.mjs\n\n");
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(exitCode, 0);
    assert.equal(received.authorization, "Bearer test-cdr-secret");
    assert.equal(received.body.client_phone, "79991234567");
    assert.equal(received.body.caller_id, "79031112233");
    assert.equal(received.body.call_id, "call-1");
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Asterisk renderer creates separate provider and authenticated user transports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "callbridge-render-"));
  const env = {
    ...process.env,
    SIP_PUBLIC_IP: "188.225.39.38",
    SKOROZVON_SIP_USERNAME: "skorozvon-test",
    SKOROZVON_SIP_PASSWORD: "s".repeat(32),
    MANAGER_SIP_USERNAME: "manager-test",
    MANAGER_SIP_PASSWORD: "m".repeat(32),
    ASTERISK_AMI_USERNAME: "callbridge",
    ASTERISK_AMI_SECRET: "a".repeat(32),
    PBX_CDR_SECRET: "c".repeat(32),
    BEELINE_SIP_HOST: "voip.beeline.ru",
    BEELINE_SIP_PORT: "5060"
  };
  try {
    const child = spawn(process.execPath, ["deploy/render-asterisk.mjs", directory], { cwd: process.cwd(), env, stdio: "ignore" });
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(exitCode, 0);
    const pjsip = await readFile(join(directory, "pjsip_callbridge.conf"), "utf8");
    const dialplan = await readFile(join(directory, "extensions_callbridge.conf"), "utf8");
    assert.match(pjsip, /bind=0\.0\.0\.0:5060/);
    assert.match(pjsip, /bind=0\.0\.0\.0:5070/);
    assert.match(pjsip, /auth=skorozvon-callbridge-auth/);
    assert.match(dialplan, /AGI\(callbridge-cdr-agi\.mjs/);
    assert.doesNotMatch(pjsip, /REPLACE_WITH/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
