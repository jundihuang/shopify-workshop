import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildConnectionArtifact,
  parseStoreInfoResult,
  REQUIRED_SCOPES,
} from "../src/store.js";
import {
  assertNoRawAccessUrl,
  ensureWorkshopGitignore,
  updateWorkshopStateYaml,
} from "../src/files.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, "../fixtures");

test("connection artifact contains handles but never the accessUrl", async () => {
  const info = parseStoreInfoResult(
    JSON.parse(await readFile(path.join(fixtureDir, "store-info.success.json"), "utf8")),
  );
  const connection = buildConnectionArtifact({
    domain: info.domain,
    storeName: info.storeName,
    scopes: info.scopes,
    passwordProtectionEnabled: true,
    productCount: 0,
  });
  const serialized = `${JSON.stringify(connection, null, 2)}\n`;

  assert.equal(connection.storefront_session, "access_url");
  assert.equal(connection.auth, "cli_cached_admin_token");
  assert.equal(connection.store_type, "preview");
  assert.deepEqual(connection.scopes_include, REQUIRED_SCOPES);
  assert.equal(connection.password_protection_enabled, true);
  assert.equal(serialized.includes(info.accessUrl), false);
  assert.equal(serialized.includes("password\""), false);
  assert.doesNotThrow(() => assertNoRawAccessUrl(serialized, info.accessUrl));
  assert.throws(
    () => assertNoRawAccessUrl(`url=${info.accessUrl}`, info.accessUrl),
    /Refusing to write/,
  );
});

test("updates only connection while preserving unrelated workshop state", () => {
  const existing = `group_id: "A"
store_domain: "old-preview.myshopify.com"
mode: "demo"

connection:
  status: pending
  store_type: preview
  scopes_ok: false
  auth: cli_cached_admin_token
  storefront_session: none

products:
  source_file: "products.sample.csv"
  imported: 3
  failed: 0
  status: done
  channel_status: draft

brand:
  brief_file: null
  status: pending
  fallback_used: false
`;

  const updated = updateWorkshopStateYaml(existing, {
    groupId: "A",
    storeDomain: "aurora-workshop-mvp.myshopify.com",
    mode: "hands_on",
    status: "connected",
    scopesOk: true,
  });

  assert.match(updated, /store_domain: "aurora-workshop-mvp\.myshopify\.com"/);
  assert.match(updated, /status: connected/);
  assert.match(updated, /scopes_ok: true/);
  assert.match(updated, /storefront_session: access_url/);
  assert.match(updated, /products:\n  source_file: "products\.sample\.csv"\n  imported: 3/);
  assert.match(updated, /brand:\n  brief_file: null/);
  assert.doesNotMatch(updated, /access[_-]?url\s*:\s*https?:\/\//i);
});

test("ensures .workshop/ is present in the repo gitignore idempotently", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "store-connect-gitignore-"));
  try {
    await mkdir(path.join(temp, ".git"));
    await writeFile(path.join(temp, ".gitignore"), "node_modules/\n", "utf8");
    const groupDir = path.join(temp, ".workshop", "A");

    const first = await ensureWorkshopGitignore(groupDir);
    const second = await ensureWorkshopGitignore(groupDir);
    assert.equal(first, path.join(temp, ".gitignore"));
    assert.equal(second, first);

    const text = await readFile(first, "utf8");
    assert.equal((text.match(/^\.workshop\/$/gm) || []).length, 1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
