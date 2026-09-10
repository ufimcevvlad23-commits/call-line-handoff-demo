import { createHmac, timingSafeEqual } from "node:crypto";

function payload(entityType, entityId) {
  const type = entityType === "deal" ? "deal" : "lead";
  const id = String(entityId || "");
  if (!/^\d+$/.test(id)) throw new Error("Некорректный ID CRM-сущности");
  return `${type}:${id}`;
}

export function signEntity(entityType, entityId, secret) {
  if (!secret) throw new Error("Не настроен секрет действия менеджера");
  return createHmac("sha256", secret).update(payload(entityType, entityId)).digest("base64url");
}

export function verifyEntitySignature(entityType, entityId, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const expected = Buffer.from(signEntity(entityType, entityId, secret));
    const supplied = Buffer.from(String(signature));
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  } catch {
    return false;
  }
}

export function buildManagerLink(baseUrl, entityType, entityId, secret) {
  const url = new URL("/manager-call", String(baseUrl).replace(/\/$/, ""));
  url.searchParams.set("entityType", entityType === "deal" ? "deal" : "lead");
  url.searchParams.set("entityId", String(entityId));
  url.searchParams.set("signature", signEntity(entityType, entityId, secret));
  return url.toString();
}
