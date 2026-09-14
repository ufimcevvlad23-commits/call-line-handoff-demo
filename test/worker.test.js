import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoQualify } from "../lib/worker.js";

const env = {
  SKOROZVON_AUTO_QUALIFY_ENABLED: "true",
  SKOROZVON_AUTO_QUALIFY_SCENARIO_IDS: "60000006035",
  SKOROZVON_AUTO_QUALIFY_RESULT_GROUPS: "Успешные",
  SKOROZVON_AUTO_QUALIFY_NOT_BEFORE: "2026-09-14T06:45:00Z"
};

test("auto-qualifies only a new successful call in the configured scenario", () => {
  assert.equal(shouldAutoQualify({
    scenarioId: "60000006035",
    resultGroup: "успешные",
    connectedAt: "2026-09-14T06:45:01Z"
  }, env), true);
  assert.equal(shouldAutoQualify({
    scenarioId: "60000006035",
    resultGroup: "Успешные",
    connectedAt: "2026-09-14T06:44:59Z"
  }, env), false);
  assert.equal(shouldAutoQualify({
    scenarioId: "other",
    resultGroup: "Успешные",
    connectedAt: "2026-09-14T06:46:00Z"
  }, env), false);
});

test("auto-qualification fails closed without an explicit cutoff", () => {
  assert.equal(shouldAutoQualify({
    scenarioId: "60000006035",
    resultGroup: "Успешные",
    connectedAt: "2026-09-14T06:46:00Z"
  }, { ...env, SKOROZVON_AUTO_QUALIFY_NOT_BEFORE: "" }), false);
});
