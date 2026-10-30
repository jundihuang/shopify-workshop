import test from "node:test";
import assert from "node:assert/strict";
import { buildScorecard } from "../src/scorecard.js";
import {
  DIMENSION_KEYS,
  WEIGHTS,
  gradeFor,
  scoreProduct,
  weightedScore,
} from "../src/score.js";

const RICH = {
  handle: "heavyweight-cotton-tee",
  title: "Heavyweight Cotton Oversized T-Shirt",
  description: "Heavyweight cotton oversized t-shirt with a clean everyday structure. What material is this? 100% cotton. Shipping and returns follow the store policy.",
  productType: "T-Shirt",
  vendor: "INFLATION",
  tags: ["cotton"],
  seo: {
    title: "Heavyweight Cotton Oversized T-Shirt",
    description: "Heavyweight cotton oversized t-shirt for everyday wear, with a relaxed structure and a simple fabric story.",
  },
  media: [{ url: "https://cdn.shopify.com/s/files/1/0800/5612/3704/files/tee.jpg", alt: "Heavyweight cotton t-shirt" }],
  options: [{ name: "Size", values: ["S", "M"] }],
  variants: [{ sku: "265SS187S", price: "19.99" }],
  faq: "What material is this? 100% cotton.",
};

const THIN = {
  handle: "workshop-thin-tee",
  title: "Tee",
  description: "A shirt.",
  productType: "",
  vendor: "",
  tags: [],
  seo: { title: "", description: "" },
  media: [],
  options: [],
  variants: [{ sku: "", price: "10.00" }],
  faq: "",
};

test("grade boundaries follow the published workshop scale", () => {
  assert.equal(gradeFor(100), "A+");
  assert.equal(gradeFor(90), "A+");
  assert.equal(gradeFor(89), "A");
  assert.equal(gradeFor(80), "A");
  assert.equal(gradeFor(79), "B");
  assert.equal(gradeFor(70), "B");
  assert.equal(gradeFor(69), "C");
  assert.equal(gradeFor(60), "C");
  assert.equal(gradeFor(59), "D");
  assert.equal(gradeFor(0), "D");
});

test("five dimensions are present and weights sum to 1", () => {
  assert.deepEqual(DIMENSION_KEYS, [
    "product_data_completeness",
    "search_findability",
    "ai_understandability",
    "purchase_trust",
    "technical_visibility",
  ]);
  const sum = DIMENSION_KEYS.reduce((total, key) => total + WEIGHTS[key], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const even = Object.fromEntries(DIMENSION_KEYS.map((key) => [key, 60]));
  assert.equal(weightedScore(even), 60);
  assert.equal(gradeFor(weightedScore(even)), "C");
  const perfect = Object.fromEntries(DIMENSION_KEYS.map((key) => [key, 100]));
  assert.equal(weightedScore(perfect), 100);
  assert.equal(gradeFor(weightedScore(perfect)), "A+");
});

test("thin admin product is a P0 and scores below a filled product", () => {
  const thin = scoreProduct(THIN, null);
  const rich = scoreProduct(RICH, null);
  assert.equal(thin.priority, "P0");
  assert.ok(thin.missing_fields.includes("title"));
  assert.ok(thin.missing_fields.includes("seo_title"));
  assert.ok(thin.missing_fields.includes("image"));
  assert.equal(thin.schema_status, "not_checked");
  assert.equal(thin.seo_status, "missing");
  assert.ok(rich.score > thin.score);
  assert.equal(rich.seo_status, "present");
  assert.equal(rich.ai_readability_status, "clear");
  assert.ok(rich.score <= 100);
  assert.ok(thin.score >= 0);
});

test("admin-only when HTML is skipped, and schema raises AI when HTML is present", () => {
  const skipped = buildScorecard({
    store: "aurora-workshop-mvp.myshopify.com",
    products: [RICH, THIN],
    htmlSkipped: true,
    channelReady: true,
  });
  assert.equal(skipped.evidence_mode, "admin_only");
  assert.ok(skipped.restrictions.includes("html_evidence_skipped"));
  assert.ok(skipped.restrictions.includes("unauthenticated_storefront_restricted"));
  assert.equal(skipped.products.every((product) => product.schema_status === "not_checked"), true);
  assert.equal(skipped.grade, gradeFor(skipped.geo_score));
  for (const key of DIMENSION_KEYS) {
    assert.equal(typeof skipped.dimensions[key], "number");
  }

  const hybrid = buildScorecard({
    store: "aurora-workshop-mvp.myshopify.com",
    products: [RICH],
    htmlByHandle: {
      [RICH.handle]: { checked: true, schema_present: true, opening_soon: false },
    },
    htmlSkipped: false,
    channelReady: true,
  });
  const adminRich = buildScorecard({
    store: "aurora-workshop-mvp.myshopify.com",
    products: [RICH],
    htmlSkipped: true,
    channelReady: true,
  });
  assert.equal(hybrid.evidence_mode, "hybrid_admin_preview");
  assert.equal(hybrid.restrictions.includes("html_evidence_skipped"), false);
  assert.equal(hybrid.products[0].schema_status, "present");
  assert.ok(hybrid.dimensions.ai_understandability >= adminRich.dimensions.ai_understandability);
  assert.ok(hybrid.geo_score >= adminRich.geo_score);
  assert.equal(JSON.stringify(hybrid).includes("accessUrl"), false);
});

test("sample is capped at 10 products", () => {
  const products = Array.from({ length: 12 }, (_, index) => ({
    ...THIN,
    handle: `workshop-tee-${String(index + 1).padStart(2, "0")}`,
    title: `Workshop Tee ${index + 1} Extra`,
  }));
  const scorecard = buildScorecard({
    store: "aurora-workshop-mvp.myshopify.com",
    products,
    htmlSkipped: true,
    channelReady: true,
  });
  assert.equal(scorecard.products.length, 10);
  assert.equal(scorecard.products[0].handle, "workshop-tee-01");
  assert.equal(scorecard.products[9].handle, "workshop-tee-10");
  assert.ok(scorecard.restrictions.includes("sample_capped_at_10"));
  assert.equal(scorecard.grade, gradeFor(scorecard.geo_score));
});

test("channel precheck is admin-only and keeps a safe preview url only", () => {
  const scorecard = buildScorecard({
    store: "aurora-workshop-mvp.myshopify.com",
    previewUrl: "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=123&password=nope",
    products: [THIN],
    htmlSkipped: true,
    channelReady: false,
  });
  assert.equal(scorecard.evidence_mode, "admin_only");
  assert.equal(scorecard.preview_url, undefined);
  assert.ok(scorecard.restrictions.includes("channel_not_online_store"));
  assert.equal(JSON.stringify(scorecard).includes("password"), false);

  const safe = buildScorecard({
    store: "aurora-workshop-mvp.myshopify.com",
    previewUrl: "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=123",
    products: [RICH],
    htmlSkipped: true,
    channelReady: true,
  });
  assert.equal(safe.preview_url, "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=123");
});
