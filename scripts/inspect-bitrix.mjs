import process from "node:process";
import { createInterface } from "node:readline/promises";

const input = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
const baseUrl = (await input.question("")).trim().replace(/\/$/, "");
input.close();

if (!/^https:\/\/[^/]+\.bitrix24\.ru\/rest\/\d+\/[a-z0-9]+$/i.test(baseUrl)) {
  throw new Error("Некорректный адрес входящего вебхука Bitrix24");
}

async function call(method, params = {}) {
  const response = await fetch(`${baseUrl}/${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`${method}: ${data.error_description || data.error || response.status}`);
  }
  return data.result;
}

const scope = await call("scope");
const profile = await call("profile");
let users = [];
let userLookup = "ok";
try {
  users = await call("user.search", {
    FILTER: { NAME: "Владислав", LAST_NAME: "Уфимцев" }
  });
} catch {
  try {
    users = await call("user.get", {
      FILTER: { NAME: "Владислав", LAST_NAME: "Уфимцев" }
    });
  } catch (error) {
    userLookup = error.message.includes("higher privileges") ? "insufficient-scope" : "failed";
  }
}

console.log(JSON.stringify({
  ok: true,
  scope: Array.isArray(scope) ? scope : [],
  webhookUser: profile ? { id: String(profile.ID), name: profile.NAME, lastName: profile.LAST_NAME } : null,
  userLookup,
  matchedUsers: (Array.isArray(users) ? users : []).map((user) => ({
    id: String(user.ID),
    name: user.NAME,
    lastName: user.LAST_NAME,
    active: user.ACTIVE
  }))
}, null, 2));
