import { timingSafeEqual } from "node:crypto";

export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error("Слишком большой запрос");
  }
  return raw ? JSON.parse(raw) : {};
}

export function isAuthorized(req, secret) {
  if (!secret) return true;
  const header = String(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(header);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
