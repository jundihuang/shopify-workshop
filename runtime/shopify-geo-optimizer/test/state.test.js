import test from "node:test";
import assert from "node:assert/strict";
import { updateOptimizerState } from "../src/state.js";

const EXISTING = `group_id: "A"
store_domain: "aurora-workshop-mvp.myshopify.com"

geo:
  evidence_mode: admin_only
  before_score: 35
  after_score: null
  optimizer_status: pending
  restrictions:
    - html_evidence_skipped
`;

test("optimizer state updates after_score and optimizer_status only", () => {
  const next = updateOptimizerState(EXISTING, {
    afterScore: 74,
    optimizerStatus: "approved_p0_batch",
  });
  assert.match(next, /^ {2}after_score: 74$/m);
  assert.match(next, /^ {2}optimizer_status: approved_p0_batch$/m);
  assert.match(next, /^ {2}before_score: 35$/m);
  assert.match(next, /^ {2}evidence_mode: admin_only$/m);
  assert.match(next, /html_evidence_skipped/);
  assert.doesNotMatch(next, /accessUrl/);
});
