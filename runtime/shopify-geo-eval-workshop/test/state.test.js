import test from "node:test";
import assert from "node:assert/strict";
import { readWorkshopFacts, updateGeoBeforeState } from "../src/state.js";

const EXISTING = `group_id: "A"
store_domain: "aurora-workshop-mvp.myshopify.com"
mode: "hands_on"

connection:
  status: connected
  store_type: preview
  scopes_ok: true
  auth: cli_cached_admin_token
  storefront_session: access_url

products:
  source_file: "products.csv"
  imported: 8
  failed: 0
  status: done
  channel_status: online_store_active

brand:
  brief_file: brand-brief.json
  status: done

theme:
  theme_id: 123
  status: unpublished
  preview_url: "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=123"
  fallback_used: false

geo:
  evidence_mode: admin_only
  before_score: null
  after_score: 84
  optimizer_status: pending
  restrictions:
    - old_restriction
`;

test("geo before update preserves later sections and other geo keys", () => {
  const next = updateGeoBeforeState(EXISTING, {
    beforeScore: 64,
    evidenceMode: "admin_only",
    restrictions: ["html_evidence_skipped", "unauthenticated_storefront_restricted"],
  });
  assert.match(next, /^ {2}evidence_mode: admin_only$/m);
  assert.match(next, /^ {2}before_score: 64$/m);
  assert.match(next, /^ {2}after_score: 84$/m);
  assert.match(next, /^ {2}optimizer_status: pending$/m);
  assert.match(next, /channel_status: online_store_active/);
  assert.match(next, /preview_url: "https:\/\/aurora-workshop-mvp\.myshopify\.com\/\?preview_theme_id=123"/);
  assert.match(next, /storefront_session: access_url/);
  assert.doesNotMatch(next, /old_restriction/);
  assert.match(next, /html_evidence_skipped/);
  assert.equal(next.includes("https://preview.example.invalid"), false);
  const facts = readWorkshopFacts(next);
  assert.equal(facts.channelStatus, "online_store_active");
  assert.equal(facts.storefrontSession, "access_url");
  assert.equal(facts.previewUrl, "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=123");
  assert.equal(facts.storeDomain, "aurora-workshop-mvp.myshopify.com");
});

test("geo before update refuses an accessUrl assignment", () => {
  assert.throws(
    () => updateGeoBeforeState(`accessUrl: https://preview.example.invalid/secret\n`, {
      beforeScore: 10,
      evidenceMode: "admin_only",
      restrictions: [],
    }),
    /accessUrl/,
  );
});
