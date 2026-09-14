import test from "node:test";
import assert from "node:assert/strict";
import { buildCallerSourcePhoneMap, normalizeSkorozvonCall } from "../lib/skorozvon.js";

test("resolves a Skorozvon source UUID to its SIP registration phone", () => {
  const phones = buildCallerSourcePhoneMap({
    data: [
      { uuid: "source-1", phone: "968 990-17-86" },
      { uuid: "invalid", phone: "sip-login" }
    ]
  });
  const call = normalizeSkorozvonCall({
    id: 42,
    phone: "+7 999 123-45-67",
    source: "source-1",
    connected_at: "2026-09-14T09:00:00+03:00"
  }, phones);
  assert.equal(call.successfulCallerId, "79689901786");
  assert.equal(call.clientPhone, "79991234567");
});

test("prefers an explicit source phone and ignores an unresolved UUID", () => {
  assert.equal(normalizeSkorozvonCall({ id: 1, phone: "79991234567", source_phone: "+79031112233" }).successfulCallerId, "79031112233");
  assert.equal(normalizeSkorozvonCall({ id: 2, phone: "79991234567", source: "uuid-only" }).successfulCallerId, "");
});

test("builds a source map from caller source collections", () => {
  const phones = buildCallerSourcePhoneMap({
    data: {
      caller_numbers: [{ uuid: "number-1", phone: "+79031112233" }],
      sip_registrations: [{ uuid: "sip-1", phone: "79032223344" }]
    }
  });
  assert.equal(phones.get("number-1"), "79031112233");
  assert.equal(phones.get("sip-1"), "79032223344");
});
