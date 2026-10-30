import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBriefFromDemo } from "../src/normalize.js";
import { defaultDemoPath, defaultSchemaPath } from "../src/paths.js";
import { loadBrandBriefSchema, validateBrandBrief } from "../src/schema.js";

test("schema requires the workshop brand brief fields", async () => {
  const schema = await loadBrandBriefSchema();
  assert.equal(schema.$id, "https://beansmile.local/schemas/brand-brief.json");
  assert.deepEqual(schema.required, [
    "brand_name",
    "tagline",
    "audience",
    "positioning",
    "tone",
    "visual",
    "selling_points",
    "locale",
    "currency",
  ]);
  assert.deepEqual(schema.properties.audience.required, ["primary"]);
  const onDisk = JSON.parse(await readFile(defaultSchemaPath(), "utf8"));
  assert.deepEqual(onDisk.required, schema.required);
});

test("Aurora Skincare demo brief validates and has no risk flags", async () => {
  const schema = await loadBrandBriefSchema();
  const demo = JSON.parse(await readFile(defaultDemoPath(), "utf8"));
  assert.deepEqual(validateBrandBrief(demo, schema), []);
  const prepared = buildBriefFromDemo(demo);
  assert.equal(prepared.source, "demo");
  assert.deepEqual(prepared.missing, []);
  assert.deepEqual(prepared.risk_flags, []);
  assert.equal(prepared.brief.brand_name, "Aurora Skincare");
  assert.equal(prepared.brief.locale, "en-US");
  assert.equal(prepared.brief.currency, "USD");
  assert.deepEqual(prepared.brief.tone.avoid, demo.tone.avoid);
  for (const page of ["home", "collection", "product"]) {
    assert.equal(typeof prepared.brief.pages[page].intent, "string");
    assert.ok(prepared.brief.pages[page].sections.length > 0);
  }
});

test("schema validation reports missing required fields and wrong types", async () => {
  const schema = await loadBrandBriefSchema();
  const missingName = {
    tagline: "Hello",
    audience: { primary: "Shoppers" },
    positioning: "Plain goods.",
    tone: { voice: "calm" },
    visual: { primary_color: "#112233" },
    selling_points: ["One fact"],
    locale: "en-US",
    currency: "USD",
  };
  const missingErrors = validateBrandBrief(missingName, schema);
  assert.ok(missingErrors.some((error) => error.path === "brand_name"));

  const emptyAudience = {
    ...missingName,
    brand_name: "Example",
    audience: {},
  };
  const audienceErrors = validateBrandBrief(emptyAudience, schema);
  assert.ok(audienceErrors.some((error) => error.path === "audience.primary"));

  const wrongType = {
    ...missingName,
    brand_name: "Example",
    audience: { primary: "Shoppers" },
    selling_points: "not-an-array",
  };
  const typeErrors = validateBrandBrief(wrongType, schema);
  assert.ok(typeErrors.some((error) => error.path === "selling_points"));
});
