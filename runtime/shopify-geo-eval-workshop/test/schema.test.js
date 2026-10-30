import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defaultSchemaPath } from "../src/paths.js";
import { buildScorecard } from "../src/scorecard.js";
import { loadGeoScoreSchema, validateGeoScore } from "../src/schema.js";

const PRODUCT = {
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
  media: [{ url: "https://cdn.shopify.com/s/files/1/0800/5612/3704/files/tee.jpg", alt: "tee" }],
  options: [{ name: "Size", values: ["M"] }],
  variants: [{ sku: "265SS187S", price: "19.99" }],
  faq: "What material is this? 100% cotton.",
};

test("schema requires the five workshop dimensions", async () => {
  const schema = await loadGeoScoreSchema();
  assert.equal(schema.title, "ShopWright Workshop GEO Scorecard");
  assert.deepEqual(schema.properties.dimensions.required, [
    "product_data_completeness",
    "search_findability",
    "ai_understandability",
    "purchase_trust",
    "technical_visibility",
  ]);
  assert.deepEqual(schema.properties.grade.enum, ["A+", "A", "B", "C", "D"]);
  assert.deepEqual(schema.properties.evidence_mode.enum, ["hybrid_admin_preview", "admin_only"]);
  assert.equal(schema.properties.skill.const, "shopify-geo-eval-workshop");
  const onDisk = JSON.parse(await readFile(defaultSchemaPath(), "utf8"));
  assert.deepEqual(onDisk.properties.dimensions.required, schema.properties.dimensions.required);
});

test("built scorecard matches the workshop schema", async () => {
  const schema = await loadGeoScoreSchema();
  const scorecard = buildScorecard({
    store: "aurora-workshop-mvp.myshopify.com",
    products: [PRODUCT],
    htmlSkipped: true,
    channelReady: true,
  });
  assert.deepEqual(validateGeoScore(scorecard, schema), []);
  assert.equal(scorecard.skill, "shopify-geo-eval-workshop");
  assert.equal(scorecard.products.length <= 10, true);

  const broken = { ...scorecard, grade: "F", skill: "shopify-geo-eval" };
  delete broken.dimensions.technical_visibility;
  const errors = validateGeoScore(broken, schema);
  assert.ok(errors.some((entry) => entry.path === "grade"));
  assert.ok(errors.some((entry) => entry.path === "dimensions.technical_visibility"));
  assert.ok(errors.some((entry) => entry.path === "skill"));
});
