import test from "node:test";
import assert from "node:assert/strict";
import { fieldCopies, readConstraints, sanitizeCopy } from "../src/copy.js";

const dirtyBrief = {
  brand_name: "Aurora Skincare",
  category: "serum",
  scene: "a short morning routine",
  selling_points: [
    "Ingredient names in plain language",
    "clinically proven miracle cure",
    "luxury hype",
  ],
  tone: {
    avoid: [
      "luxury hype",
      "miracle",
      "medical claims (cure, heal, diagnose, clinically proven)",
    ],
  },
};

test("tone.avoid and medical phrasing are removed from after text", () => {
  const constraints = readConstraints(dirtyBrief);
  assert.deepEqual(constraints.sellingPoints, ["Ingredient names in plain language"]);
  assert.equal(constraints.sellingPoints.some((point) => /miracle|cure|clinically proven|luxury hype/i.test(point)), false);

  const copies = fieldCopies({ handle: "daily-serum", constraints });
  for (const [field, after] of Object.entries(copies)) {
    assert.equal(typeof after, "string");
    assert.doesNotMatch(after, /miracle|clinically\s+proven|\bcure\b|luxury hype|guaranteed|medical-grade/i, field);
  }
  assert.match(copies.description, /serum/i);
  assert.match(copies.description, /morning routine/i);
  assert.match(copies.description, /Ingredient names in plain language/);
  assert.match(copies.title, /serum/i);
  assert.match(copies.title, /morning routine/i);
  assert.match(copies.key_attributes, /category: serum/i);
  assert.match(copies.key_attributes, /morning routine/i);
  assert.ok(copies.meta_title.length >= 50 && copies.meta_title.length <= 65, copies.meta_title);
  assert.ok(
    copies.meta_description.length >= 140 && copies.meta_description.length <= 160,
    `${copies.meta_description.length} ${copies.meta_description}`,
  );
});

test("sanitizeCopy strips a banned phrase that was edited into after text", () => {
  const cleaned = sanitizeCopy("Aurora miracle cure serum for overnight results", ["luxury hype"]);
  assert.doesNotMatch(cleaned, /miracle|\bcure\b|overnight/i);
  assert.match(cleaned, /Aurora/);
  assert.match(cleaned, /serum/);
});
