import { bitrixCall } from "../lib/bitrix.js";
import { getFieldMap, normalizePhone } from "../lib/calls.js";

const leadId = String(process.argv[2] || "").trim();
if (!/^\d+$/.test(leadId)) throw new Error("Usage: node scripts/verify-live.mjs <lead-id>");

const fieldMap = getFieldMap();
const lead = await bitrixCall("crm.lead.get", { id: leadId });
const expectedPhone = normalizePhone(process.env.TEST_CLIENT_PHONE || "");
const actualPhone = normalizePhone(lead.PHONE?.[0]?.VALUE || lead[fieldMap.clientPhone] || "");
const callerId = normalizePhone(lead[fieldMap.successfulCallerId] || "");
const callLink = String(lead[fieldMap.callLink] || "");

console.log(JSON.stringify({
  ok: true,
  leadId: String(lead.ID),
  statusId: lead.STATUS_ID,
  assignedById: String(lead.ASSIGNED_BY_ID || ""),
  clientPhoneMatches: Boolean(expectedPhone) && actualPhone === expectedPhone,
  callerIdResolved: Boolean(callerId),
  handoffStatus: lead[fieldMap.handoffStatus] || "",
  sessionStored: Boolean(lead[fieldMap.sessionId]),
  externalAccessStored: Boolean(lead[fieldMap.externalAccessId]),
  managerLinkStored: /^https:\/\//i.test(callLink),
  lastError: lead[fieldMap.lastError] || ""
}, null, 2));
