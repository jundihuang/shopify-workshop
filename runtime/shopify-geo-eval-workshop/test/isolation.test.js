import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function sourceText() {
  const files = [path.join(packageRoot, "README.md")];
  const srcDir = path.join(packageRoot, "src");
  const entries = await readdir(srcDir);
  for (const entry of entries) {
    if (entry.endsWith(".js")) files.push(path.join(srcDir, entry));
  }
  const chunks = [];
  for (const file of files) chunks.push(await readFile(file, "utf8"));
  return chunks.join("\n");
}

test("workshop runtime does not vendor the full diagnostic", async () => {
  const text = await sourceText();
  assert.doesNotMatch(text, /methodology\.md|engine_scoring|fuse_scorecard|onlineStorePasswordProtectionUpdate/);
  assert.doesNotMatch(text, /scripts\/run\.py|\baudit\.py\b|\bbuild_report\.py\b/);
  assert.doesNotMatch(text, /\bG[1-9]\b|\bS[1-7]\b/);
  assert.match(text, /shopify-geo-eval-workshop/);
  assert.match(text, /workshop scorecard, not the full diagnostic/);
});
