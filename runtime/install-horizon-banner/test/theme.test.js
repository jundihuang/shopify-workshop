import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildImageRef,
  findHeroSection,
  heroBannerState,
  heroCopyState,
  parseTemplateJson,
  stripTemplateComment,
  withHeroBannerImage,
  withHeroCopy,
} from "../src/theme.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../fixtures/horizon-index.json");

test("stripTemplateComment removes the Horizon auto-generated comment header", () => {
  const raw = "/* auto-generated */\n{\"a\":1}";
  assert.equal(stripTemplateComment(raw), "{\"a\":1}");
  assert.equal(stripTemplateComment("{\"a\":1}"), "{\"a\":1}");
});

test("the bundled Horizon fixture parses and exposes its hero section", async () => {
  const raw = await readFile(fixturePath, "utf8");
  const index = parseTemplateJson(raw);
  const { key, section } = findHeroSection(index);
  assert.equal(section.type, "hero");
  assert.match(key, /^hero_/);
  assert.equal(heroBannerState(index, key), null, "fixture hero starts without a banner image");
});

test("findHeroSection throws when no hero exists", () => {
  assert.throws(() => findHeroSection({ order: ["other"], sections: { other: { type: "rich-text" } } }), /No hero section/);
});

test("buildImageRef converts CDN URLs to the shopify://shop_images protocol", () => {
  assert.equal(
    buildImageRef("https://cdn.shopify.com/s/files/1/1/1/files/photo-abc-123_xyz.jpg?v=1793874239"),
    "shopify://shop_images/photo-abc-123_xyz.jpg",
  );
  assert.throws(() => buildImageRef("not-a-url"));
  assert.throws(() => buildImageRef("https://example.com/noextension"));
});

test("withHeroBannerImage sets image_1 without mutating the input", async () => {
  const index = parseTemplateJson(await readFile(fixturePath, "utf8"));
  const { key } = findHeroSection(index);
  const next = withHeroBannerImage(index, key, "shopify://shop_images/workshop-banner.jpg");
  assert.equal(heroBannerState(next, key), "shopify://shop_images/workshop-banner.jpg");
  assert.equal(heroBannerState(index, key), null, "original object untouched");
  assert.deepEqual(Object.keys(index.sections), Object.keys(next.sections), "section set unchanged");
});

test("withHeroCopy updates the first text and button blocks", async () => {
  const index = parseTemplateJson(await readFile(fixturePath, "utf8"));
  const { key } = findHeroSection(index);
  const next = withHeroCopy(index, key, {
    heading: "Heavyweight tees, broken in from day one.",
    buttonLabel: "Shop the collection",
  });
  const copy = heroCopyState(next, key);
  assert.equal(copy.heading, "<p>Heavyweight tees, broken in from day one.</p>");
  assert.equal(copy.button_label, "Shop the collection");
  const before = heroCopyState(index, key);
  assert.notEqual(before.heading, copy.heading, "original copy untouched");
});

test("withHeroCopy keeps existing HTML and skips null fields", async () => {
  const index = parseTemplateJson(await readFile(fixturePath, "utf8"));
  const { key } = findHeroSection(index);
  const next = withHeroCopy(index, key, { heading: "<h2>Custom <em>HTML</em></h2>" });
  assert.equal(heroCopyState(next, key).heading, "<h2>Custom <em>HTML</em></h2>");
  assert.equal(heroCopyState(next, key).button_label, heroCopyState(index, key).button_label);
});
