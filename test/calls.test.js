import test from "node:test";
import assert from "node:assert/strict";
import { buildCrmFields, normalizePhone, normalizeSkorozvonEvent, parseLineMap, validateEvent } from "../lib/calls.js";

test("normalizes Russian phone numbers", () => {
  assert.equal(normalizePhone("8 (999) 123-45-67"), "79991234567");
  assert.equal(normalizePhone("9991234567"), "79991234567");
});

test("accepts common Skorozvon field names", () => {
  const event = normalizeSkorozvonEvent({ data: { call_id: "abc", phone: "+79991234567", from_number: "+79031112233" } });
  assert.deepEqual(validateEvent(event), []);
  assert.equal(event.successfulCallerId, "79031112233");
});

test("maps caller id to Bitrix line id", () => {
  const map = parseLineMap('{"+7 903 111-22-33":"reg151083"}');
  assert.equal(map["79031112233"], "reg151083");
});

test("builds CRM fields", () => {
  const event = normalizeSkorozvonEvent({ call_id: "abc", client_phone: "79991234567", caller_id: "79031112233" });
  const fields = buildCrmFields(event, "reg151083", { leadStatusId: "NEW", assignedById: "42" });
  assert.equal(fields.UF_CRM_SUCCESS_CALLER_ID, "79031112233");
  assert.equal(fields.UF_CRM_SUCCESS_LINE_ID, "reg151083");
  assert.equal(fields.STATUS_ID, "NEW");
  assert.equal(fields.ASSIGNED_BY_ID, "42");
  assert.equal(fields.PHONE[0].VALUE, "+79991234567");
});

test("defaults new events to leads", () => {
  const event = normalizeSkorozvonEvent({ call_id: "abc", client_phone: "79991234567", caller_id: "79031112233" });
  assert.equal(event.entityType, "lead");
});
