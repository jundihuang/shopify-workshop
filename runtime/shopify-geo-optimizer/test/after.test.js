import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadFixtureAfterScore } from "../src/after.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../fixtures");
const evalFixturesDir = path.resolve(__dirname, "../../shopify-geo-eval-workshop/fixtures");

const INFLATION_WEAR_HANDLES = [
  "soft-touch-100-cotton-blank-t-shirt-inflation-streetwear",
  "boxy-camo-tees-inflation-streetwear",
  "waffle-graphic-henley-long-sleeve-t-shirt-inflation-streetwear",
  "blank-oversized-boxy-tees-inflation-streetwear",
  "heavyweight-oversized-washed-tees-inflation-streetwear",
  "patchwork-washed-graphic-t-shirt-inflation-streetwear",
  "distressed-boxy-washed-tees-inflation-streetwear",
  "pink-x-ray-skeleton-boxy-t-shirt-inflation-streetwear",
];

function beforeScorecard(handles, store) {
  return {
    store,
    geo_score: 35,
    grade: "D",
    evidence_mode: "admin_only",
    restrictions: ["html_evidence_skipped", "unauthenticated_storefront_restricted"],
    dimensions: {
      product_data_completeness: 40,
      search_findability: 30,
      ai_understandability: 28,
      purchase_trust: 40,
      technical_visibility: 40,
    },
    products: handles.map((handle) => ({ handle, score: 22, priority: "P0" })),
    skill: "shopify-geo-eval-workshop",
  };
}

test("after fixture lists the 8 Inflation Wear workshop products", async () => {
  const fixture = JSON.parse(await readFile(path.join(fixturesDir, "geo.after.json"), "utf8"));
  assert.equal(fixture.products.length, 8);
  assert.equal(fixture.geo_score, 74);
  assert.equal(fixture.skill, "shopify-geo-eval-workshop");
  assert.deepEqual(
    fixture.products.map((product) => product.handle),
    INFLATION_WEAR_HANDLES,
  );
  assert.equal(
    fixture.products.some((product) => product.handle === "daily-serum" || product.handle === "night-cream"),
    false,
  );
});

test("dry-run after copies handles from an 8-product before scorecard and rewrites the store", async () => {
  const evalFixture = JSON.parse(
    await readFile(path.join(evalFixturesDir, "admin-products.success.json"), "utf8"),
  );
  const beforeHandles = evalFixture.products.map((product) => product.handle);
  assert.equal(beforeHandles.length, 8);
  assert.notDeepEqual(beforeHandles, INFLATION_WEAR_HANDLES);

  const store = "group-shop.myshopify.com";
  const after = await loadFixtureAfterScore({
    before: beforeScorecard(beforeHandles, "aurora-workshop-mvp.myshopify.com"),
    store,
  });

  assert.equal(after.store, store);
  assert.equal(after.products.length, 8);
  assert.deepEqual(
    after.products.map((product) => product.handle),
    beforeHandles,
  );
  assert.equal(after.geo_score, 74);
  assert.equal(after.evidence_mode, "admin_only");
  assert.equal(
    after.products.some((product) => product.handle === "daily-serum" || product.handle === "night-cream"),
    false,
  );
});

test("dry-run after keeps the Inflation Wear handles when the before sample size differs", async () => {
  const after = await loadFixtureAfterScore({
    before: beforeScorecard(["daily-serum", "night-cream"], "group-shop.myshopify.com"),
    store: "group-shop.myshopify.com",
  });
  assert.equal(after.store, "group-shop.myshopify.com");
  assert.deepEqual(
    after.products.map((product) => product.handle),
    INFLATION_WEAR_HANDLES,
  );
});
