import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fillSkeleton, summarizeFill } from "../src/fill.js";
import { defaultSkeletonDir } from "../src/paths.js";

const BRIEF = {
  brand_name: "Aurora Skincare",
  tagline: "A short routine for everyday skin.",
  audience: { primary: "Adults who want a short daily skincare routine" },
  positioning: "Aurora Skincare keeps the routine short.",
  tone: { voice: "calm", avoid: ["medical claims"] },
  visual: {
    logo: "",
    primary_color: "#1F4E5F",
    secondary_color: "#F3EDE4",
  },
  selling_points: ["A three-step morning and evening routine", "Ingredient names written in plain language"],
  trust_signals: ["Full ingredient list on every product"],
  pages: {
    home: { intent: "Introduce the brand." },
    collection: { intent: "Help shoppers scan Aurora products by routine step." },
    product: { intent: "Explain one product with specific, non-medical copy." },
  },
  locale: "en-US",
  currency: "USD",
};

test("summarizeFill maps brief copy and colors without calling Shopify", () => {
  const summary = summarizeFill(BRIEF);
  assert.equal(summary.brand_name, "Aurora Skincare");
  assert.equal(summary.primary_color, "#1F4E5F");
  assert.equal(summary.secondary_color, "#F3EDE4");
  assert.equal(summary.selling_points[0], "A three-step morning and evening routine");
  assert.equal(summary.collection_intro, "Help shoppers scan Aurora products by routine step.");
  assert.deepEqual(summary.pages, ["home", "collection", "product"]);
  assert.equal(summary.products_touched, false);
  assert.ok(summary.risks.some((risk) => risk.id === "unpublished_only"));
  assert.ok(summary.risks.some((risk) => risk.id === "tone_avoid"));
  assert.equal(summary.risks.some((risk) => risk.id === "risky_copy"), false);
});

test("summarizeFill flags medical copy and falls back to the skeleton color", () => {
  const summary = summarizeFill({
    ...BRIEF,
    tagline: "A miracle overnight cream",
    visual: { ...BRIEF.visual, primary_color: "navy" },
  });
  assert.equal(summary.primary_color, "#1F4E5F");
  assert.ok(summary.risks.some((risk) => risk.id === "invalid_primary_color"));
  assert.ok(summary.risks.some((risk) => risk.id === "risky_copy" && risk.fields.includes("tagline")));
});

test("summarizeFill refuses an accessUrl field on the brief", () => {
  assert.throws(
    () => summarizeFill({ ...BRIEF, accessUrl: "https://preview.example.invalid/access/secret" }),
    /accessUrl/,
  );
});

test("fillSkeleton writes brief colors and section copy into the theme JSON", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "theme-fill-"));
  try {
    const dest = path.join(temp, "theme-work");
    await fillSkeleton({ brief: BRIEF, skeletonDir: defaultSkeletonDir(), destDir: dest });
    const settings = JSON.parse(await readFile(path.join(dest, "config", "settings_data.json"), "utf8"));
    const index = JSON.parse(await readFile(path.join(dest, "templates", "index.json"), "utf8"));
    const collection = JSON.parse(await readFile(path.join(dest, "templates", "collection.json"), "utf8"));
    const product = JSON.parse(await readFile(path.join(dest, "templates", "product.json"), "utf8"));
    const layout = await readFile(path.join(dest, "layout", "theme.liquid"), "utf8");

    assert.equal(settings.current.brand_name, "Aurora Skincare");
    assert.equal(settings.current.color_primary, "#1F4E5F");
    assert.equal(settings.current.color_secondary, "#F3EDE4");
    assert.equal(index.sections.hero.settings.heading, "Aurora Skincare");
    assert.equal(index.sections.hero.settings.text, "A short routine for everyday skin.");
    assert.equal(index.sections.selling_points.settings.point_1, "A three-step morning and evening routine");
    assert.equal(collection.sections.main.settings.intro, "Help shoppers scan Aurora products by routine step.");
    assert.equal(product.sections.main.settings.brand_note, "Explain one product with specific, non-medical copy.");
    assert.match(layout, /content_for_header/);
    assert.match(layout, /content_for_layout/);
    assert.doesNotMatch(layout, /127\.0\.0\.1|theme\s+dev|theme\s+publish/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
