import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import health from "./api/health.js";
import skorozvonEvent from "./api/skorozvon-event.js";
import call from "./api/call.js";
import managerCall from "./api/manager-call.js";
import pbxCdr from "./api/pbx-cdr.js";
import adminSummary from "./api/admin-summary.js";
import { getStore } from "./lib/store.js";
import { startBackgroundWorker } from "./lib/worker.js";

const root = dirname(fileURLToPath(import.meta.url));
const routes = new Map([
  ["/api/health", health],
  ["/api/skorozvon-event", skorozvonEvent],
  ["/api/call", call],
  ["/api/pbx-cdr", pbxCdr],
  ["/api/admin/summary", adminSummary],
  ["/manager-call", managerCall]
]);

const server = createServer(async (req, res) => {
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    const pathname = new URL(req.url, "http://localhost").pathname.replace(/\/$/, "") || "/";
    const handler = routes.get(pathname);
    if (handler) return await handler(req, res);

    if (req.method === "GET" && pathname === "/") {
      const html = await readFile(join(root, "public", "index.html"));
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      return res.end(html);
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "Маршрут не найден" }));
  } catch (error) {
    if (res.headersSent) return res.end();
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8790);
const store = getStore();
startBackgroundWorker(store);
server.listen(port, host, () => console.log(`call-bridge listening on ${host}:${port}`));
