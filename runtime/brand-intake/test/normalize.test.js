import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BASELINE_AVOID } from "../src/flags.js";
import { buildBriefFromAnswers, buildBriefFromDemo } from "../src/normalize.js";
import { defaultDemoPath, REPO_ROOT } from "../src/paths.js";
import { loadBrandBriefSchema, validateBrandBrief } from "../src/schema.js";
import path from "node:path";

test("missing answers are listed and locale/currency default without counting as gaps", async () => {
  const schema = await loadBrandBriefSchema();
  const prepared = buildBriefFromAnswers({
    brand_name: "Partial Co",
    description: "A short intro for travelers who pack light.",
  });

  assert.deepEqual(prepared.missing, [
    "audience.primary",
    "tone.voice",
    "visual.primary_color",
    "selling_points",
  ]);
  assert.deepEqual(prepared.derived, [
    { field: "positioning", from: "description" },
    { field: "tagline", from: "description" },
  ]);
  assert.equal(prepared.brief.locale, "en-US");
  assert.equal(prepared.brief.currency, "USD");
  assert.equal(prepared.brief.missing.includes("locale"), false);
  assert.equal(prepared.brief.missing.includes("currency"), false);
  assert.equal(prepared.brief.tagline, "A short intro for travelers who pack light.");
  assert.equal(prepared.brief.visual.primary_color, "#1F3A5F");
  assert.equal(prepared.brief.currency, "USD");
  assert.deepEqual(validateBrandBrief(prepared.brief, schema), []);
  for (const page of ["home", "collection", "product"]) {
    assert.equal(typeof prepared.brief.pages[page].intent, "string");
    assert.ok(prepared.brief.pages[page].sections.every((section) => typeof section.intent === "string"));
  }
});

test("sample student answers normalize to a complete brief", async () => {
  const schema = await loadBrandBriefSchema();
  const samplePath = path.join(REPO_ROOT, "templates", "brand-intake.answers.sample.json");
  const answers = JSON.parse(await readFile(samplePath, "utf8"));
  const prepared = buildBriefFromAnswers(answers);
  assert.deepEqual(prepared.missing, []);
  assert.deepEqual(prepared.risk_flags, []);
  assert.equal(prepared.brief.brand_name, "Harbor Supply");
  assert.equal(prepared.brief.locale, "en-US");
  assert.equal(prepared.brief.currency, "USD");
  assert.ok(prepared.brief.tone.avoid.includes("luxury hype"));
  for (const line of BASELINE_AVOID) {
    assert.ok(prepared.brief.tone.avoid.includes(line));
  }
  assert.deepEqual(validateBrandBrief(prepared.brief, schema), []);
});

test("medical and hype phrasing is copied into tone.avoid", () => {
  const prepared = buildBriefFromAnswers({
    brand_name: "Glow Lab",
    tagline: "The world's best miracle cream",
    positioning: "Clinically proven to cure acne overnight",
    audience: "Adults comparing ingredient lists",
    tone: "bold",
    primary_color: "#112233",
    selling_points: ["100% effective", "guaranteed results"],
    locale: "en-US",
    currency: "USD",
  });

  const avoid = prepared.brief.tone.avoid.join("\n");
  assert.match(avoid, /medical claim: "cure" \(positioning\)/);
  assert.match(avoid, /medical claim: "Clinically proven" \(positioning\)/);
  assert.match(avoid, /hype: "overnight" \(positioning\)/);
  assert.match(avoid, /hype: "miracle" \(tagline\)/);
  assert.match(avoid, /hype: "world's best" \(tagline\)/);
  assert.match(avoid, /hype: "100% effective" \(selling_points\.0\)/);
  assert.match(avoid, /hype: "guaranteed" \(selling_points\.1\)/);
  assert.equal(prepared.risk_flags.length, 7);
});

test("Chinese medical claims are flagged into tone.avoid", () => {
  const prepared = buildBriefFromAnswers({
    brand_name: "示例",
    tagline: "日常护理",
    positioning: "本品可以治愈干燥",
    audience: "想看成分表的人",
    tone: "平静",
    primary_color: "#225577",
    selling_points: ["成分写清楚"],
  });
  assert.ok(prepared.brief.tone.avoid.some((line) => line.includes("治愈") && line.includes("positioning")));
  assert.equal(prepared.brief.locale, "en-US");
  assert.equal(prepared.brief.currency, "USD");
});

test("answers that carry accessUrl are refused", () => {
  assert.throws(
    () => buildBriefFromAnswers({
      brand_name: "Nope",
      accessUrl: "https://preview.example.invalid/access/secret",
    }),
    /accessUrl/,
  );
});

test("demo loader returns the Aurora brief unchanged when copy is clean", async () => {
  const demo = JSON.parse(await readFile(defaultDemoPath(), "utf8"));
  const prepared = buildBriefFromDemo(demo);
  assert.equal(prepared.brief.brand_name, "Aurora Skincare");
  assert.deepEqual(prepared.brief, demo);
});
