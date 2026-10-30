import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approveAllP0 } from "../src/approve.js";
import { readConstraints } from "../src/copy.js";
import { P0_FIELDS } from "../src/paths.js";
import { buildProposal } from "../src/propose.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

async function loadFixtures() {
  const scorecard = JSON.parse(await readFile(path.join(fixtures, "geo.before.json"), "utf8"));
  const brief = JSON.parse(await readFile(path.join(fixtures, "brand-brief.json"), "utf8"));
  return { scorecard, brief };
}

test("committed proposal fixture matches the builder", async () => {
  const { scorecard, brief } = await loadFixtures();
  const proposal = buildProposal({ scorecard, brief, groupId: "A" });
  const committed = JSON.parse(await readFile(path.join(fixtures, "geo.proposal.json"), "utf8"));
  assert.deepEqual(committed, proposal);
});

test("proposal from fixture before.json suggests P0 fields and collapses P1", async () => {
  const { scorecard, brief } = await loadFixtures();
  const proposal = buildProposal({ scorecard, brief, groupId: "A" });
  assert.equal(proposal.source_skill, "shopify-geo-eval-workshop");
  assert.equal(proposal.ux.default_action, "approve_all_p0");
  assert.equal(proposal.ux.line_by_line_review, false);
  assert.equal(proposal.ux.deep_review_max_products, 2);
  assert.equal(proposal.ux.p1, "collapsed");
  assert.equal(proposal.constraints.category, "serum");
  assert.match(proposal.constraints.scene, /morning routine/);

  const byHandle = new Map();
  for (const item of proposal.suggestions) {
    assert.ok(item.field);
    assert.equal(typeof item.before, "string");
    assert.ok(item.after);
    assert.ok(item.reason);
    assert.ok(item.expected_impact);
    assert.ok(["P0", "P1"].includes(item.priority));
    assert.ok(["high", "medium", "low"].includes(item.confidence));
    if (!byHandle.has(item.handle)) byHandle.set(item.handle, []);
    byHandle.get(item.handle).push(item);
  }
  assert.equal(byHandle.size, 2);
  for (const items of byHandle.values()) {
    assert.ok(items.length >= 3 && items.length <= 8, `expected 3-8 suggestions, got ${items.length}`);
    const p0 = items.filter((item) => item.priority === "P0");
    assert.deepEqual(p0.map((item) => item.field).sort(), [...P0_FIELDS].sort());
    assert.equal(p0.every((item) => item.batch === true && item.collapsed === false), true);
    const p1 = items.filter((item) => item.priority === "P1");
    assert.ok(p1.length >= 1);
    assert.equal(p1.every((item) => item.batch === false && item.collapsed === true), true);
  }

  const approved = approveAllP0(proposal, { avoid: readConstraints(brief).avoid });
  assert.equal(approved.mode, "approve_all_p0");
  assert.equal(approved.suggestions.length, proposal.counts.p0);
  assert.equal(approved.suggestions.every((item) => item.priority === "P0"), true);
  assert.equal(approved.suggestions.some((item) => item.field === "faq" || item.field === "image_alt"), false);
  assert.equal(approved.line_by_line_review, false);
});

test("deep review stops at two products", async () => {
  const { scorecard, brief } = await loadFixtures();
  const proposal = buildProposal({ scorecard, brief, groupId: "A" });
  assert.throws(
    () => approveAllP0(proposal, { deepReviewHandles: ["daily-serum", "night-cream", "third"] }),
    /1–2 products/,
  );
  const approved = approveAllP0(proposal, {
    deepReviewHandles: ["daily-serum"],
    ignored: ["daily-serum:title"],
    avoid: [],
  });
  assert.deepEqual(approved.deep_review_handles, ["daily-serum"]);
  assert.equal(approved.suggestions.some((item) => item.handle === "daily-serum" && item.field === "title"), false);
  assert.equal(approved.suggestions.some((item) => item.handle === "night-cream" && item.field === "title"), true);
});
