import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function sourceText() {
  const files = [path.join(packageRoot, "README.md")];
  for (const dir of ["src", "fixtures"]) {
    const entries = await readdir(path.join(packageRoot, dir));
    for (const entry of entries) {
      if (entry.endsWith(".js") || entry.endsWith(".json") || entry.endsWith(".md")) {
        files.push(path.join(packageRoot, dir, entry));
      }
    }
  }
  const chunks = [];
  for (const file of files) chunks.push(await readFile(file, "utf8"));
  return chunks.join("\n");
}

test("optimizer does not vendor the full diagnostic", async () => {
  const text = await sourceText();
  assert.doesNotMatch(text, /methodology\.md|engine_scoring|fuse_scorecard|rules\.md|onlineStorePasswordProtectionUpdate/);
  assert.doesNotMatch(text, /scripts\/run\.py|\baudit\.py\b|\bbuild_report\.py\b/);
  assert.doesNotMatch(text, /\bG[1-9]\b|\bS[1-7]\b/);
  assert.doesNotMatch(text, /9\s*\+\s*7/);
  assert.doesNotMatch(text, /shopify-geo-eval(?!-workshop)/);
  assert.match(text, /shopify-geo-eval-workshop/);
  assert.match(text, /brand brief|brand-brief/i);
});
