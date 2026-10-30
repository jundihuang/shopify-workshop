import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extractJson } from "../src/json.js";
import {
  normalizeShopDomain,
  parseCreateStoreResult,
  parseStoreInfoResult,
  verifyScopes,
  REQUIRED_SCOPES,
} from "../src/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, "../fixtures");

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtureDir, name), "utf8"));
}

test("extractJson parses pure and noisy CLI JSON output", () => {
  assert.deepEqual(extractJson('{"status":"success"}'), { status: "success" });
  assert.deepEqual(
    extractJson('notice: starting\n{"status":"success","nested":{"ok":true}}\nwarning: done\n'),
    { status: "success", nested: { ok: true } },
  );
  assert.throws(() => extractJson("not json"), /did not return valid JSON/);
});

test("normalizes documented CLI store domain shapes", () => {
  assert.equal(normalizeShopDomain("aurora-workshop"), "aurora-workshop.myshopify.com");
  assert.equal(
    normalizeShopDomain("https://aurora-workshop.myshopify.com/admin"),
    "aurora-workshop.myshopify.com",
  );
  assert.equal(normalizeShopDomain("https://example.com"), null);
});

test("parses create preview output", async () => {
  const parsed = parseCreateStoreResult(await fixture("create-preview.success.json"));
  assert.equal(parsed.domain, "aurora-workshop-mvp.myshopify.com");
  assert.equal(parsed.storeName, "Group A Aurora");
  assert.equal(parsed.storeType, "preview");
  assert.deepEqual(parsed.scopes, [
    "write_products",
    "write_themes",
    "write_publications",
    "read_products",
    "read_themes",
  ]);
});

test("parses store info output and preserves accessUrl only in the returned object", async () => {
  const parsed = parseStoreInfoResult(await fixture("store-info.success.json"));
  assert.equal(parsed.domain, "aurora-workshop-mvp.myshopify.com");
  assert.equal(parsed.accessUrl, "https://preview.example.invalid/access/session-fixture-DO-NOT-PERSIST");
  assert.equal(parsed.passwordProtectionEnabled, null);
});

test("scope verification requires exactly the Workshop write scopes", () => {
  const ok = verifyScopes(REQUIRED_SCOPES);
  assert.equal(ok.scopes_ok, true);
  assert.deepEqual(ok.missing_scopes, []);

  const missing = verifyScopes(["write_products", "read_themes"]);
  assert.equal(missing.scopes_ok, false);
  assert.deepEqual(missing.missing_scopes, ["write_themes", "write_publications"]);
  assert.deepEqual(missing.scopes_include, ["write_products"]);
});

test("rejects non-preview stores and missing accessUrl", async () => {
  const createPayload = await fixture("create-preview.success.json");
  createPayload.store.type = "development";
  assert.throws(() => parseCreateStoreResult(createPayload), /only Preview Stores/);

  const infoPayload = await fixture("store-info.success.json");
  infoPayload.type = "production";
  assert.throws(() => parseStoreInfoResult(infoPayload), /only Preview Stores/);

  const noAccess = await fixture("store-info.success.json");
  delete noAccess.accessUrl;
  assert.throws(() => parseStoreInfoResult(noAccess), /did not include accessUrl/);
});

test("reads password protection only as a boolean switch echo", async () => {
  const payload = await fixture("store-info.success.json");
  payload.onlineStore = { passwordProtection: { enabled: true, password: "never-read" } };
  const parsed = parseStoreInfoResult(payload);
  assert.equal(parsed.passwordProtectionEnabled, true);
  assert.equal("password" in parsed, false);
});
