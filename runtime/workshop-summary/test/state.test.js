import test from "node:test";
import assert from "node:assert/strict";
import { readWorkshopFacts, updateSummaryState } from "../src/state.js";

const EXISTING = `group_id: "A"
store_domain: "group-a.myshopify.com"

connection:
  status: connected
  store_type: preview
  storefront_session: access_url

geo:
  evidence_mode: admin_only
  before_score: 35
  after_score: null
  optimizer_status: pending
  restrictions:
    - html_evidence_skipped

qa:
  preview_open: pending
`;

test("readWorkshopFacts reads scores, channel, and restrictions", () => {
  const facts = readWorkshopFacts(EXISTING);
  assert.equal(facts.storeDomain, "group-a.myshopify.com");
  assert.equal(facts.storeType, "preview");
  assert.equal(facts.storefrontSession, "access_url");
  assert.equal(facts.beforeScore, 35);
  assert.equal(facts.afterScore, null);
  assert.equal(facts.optimizerStatus, "pending");
  assert.deepEqual(facts.restrictions, ["html_evidence_skipped"]);
});

test("updateSummaryState appends summary and keeps geo and qa", () => {
  const output = updateSummaryState(EXISTING, {
    status: "demo",
    beforeScore: 35,
    afterScore: 74,
    improvement: 39,
  });
  assert.equal(output.match(/^summary:/gm).length, 1);
  assert.match(output, /^geo:\n {2}evidence_mode: admin_only\n {2}before_score: 35/m);
  assert.match(output, /optimizer_status: pending/);
  assert.match(output, /qa:\n {2}preview_open: pending/);
  assert.match(output, /summary:\n {2}status: demo\n {2}markdown: workshop-summary\.md\n {2}html: workshop-summary\.html\n {2}json: workshop-summary\.json\n {2}before_score: 35\n {2}after_score: 74\n {2}improvement: 39/);
  assert.doesNotMatch(output, /access[_-]?url\s*:\s*https?:\/\//i);
});

test("updateSummaryState replaces an existing summary block once", () => {
  const first = updateSummaryState(EXISTING, {
    status: "done",
    beforeScore: null,
    afterScore: null,
    improvement: null,
  });
  const second = updateSummaryState(first, {
    status: "demo",
    beforeScore: 35,
    afterScore: 70,
    improvement: -5,
  });
  assert.equal(second.match(/^summary:/gm).length, 1);
  assert.match(second, /status: demo/);
  assert.match(second, /improvement: -5/);
  assert.match(second, /before_score: 35/);
  assert.match(second, /qa:\n {2}preview_open: pending/);
  assert.doesNotMatch(second, /status: done/);
});

test("updateSummaryState refuses an accessUrl that would be copied through", () => {
  const dirty = `${EXISTING}access_url: https://preview.example.invalid/access/session-DO-NOT-PERSIST\n`;
  assert.throws(
    () => updateSummaryState(dirty, { status: "done", beforeScore: 1, afterScore: 2, improvement: 1 }),
    /accessUrl/,
  );
});

test("updateSummaryState rejects a status outside done or demo", () => {
  assert.throws(
    () => updateSummaryState("", { status: "pending", beforeScore: null, afterScore: null, improvement: null }),
    /summary\.status/,
  );
});
