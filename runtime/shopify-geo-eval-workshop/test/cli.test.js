import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gradeFor } from "../src/score.js";
import { loadGeoScoreSchema, validateGeoScore } from "../src/schema.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../src/cli.js");
const repoRoot = path.resolve(__dirname, "../../..");
const shellPath = path.join(repoRoot, "scripts/shopify-geo-eval-workshop.sh");
const fixtureAccessUrl = "https://preview.example.invalid/access/session-DO-NOT-PERSIST";
const store = "aurora-workshop-mvp.myshopify.com";

async function runCli(args, cwd, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { code: 0, ...result };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

function fakeShopifySource() {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SHOPIFY_ARGV_LOG, JSON.stringify(args) + "\\n");
const joined = args.join(" ");
if (/--allow-mutations|\\bmutation\\b|productUpdate|publishablePublish|theme|password|onlineStorePassword/i.test(joined)) {
  process.stderr.write("forbidden\\n");
  process.exit(3);
}
if (args[0] === "store" && args[1] === "info") {
  process.stdout.write(JSON.stringify({
    type: "preview",
    accessUrl: process.env.FIXTURE_ACCESS_URL,
    password: "should-not-leak"
  }) + "\\n");
  process.exit(0);
}
if (args[0] === "store" && args[1] === "execute") {
  const query = args[args.indexOf("--query") + 1] || "";
  if (/mutation|password|onlineStorePasswordProtectionUpdate/i.test(query)) {
    process.stderr.write("forbidden query\\n");
    process.exit(4);
  }
  const products = JSON.parse(fs.readFileSync(process.env.PRODUCTS_FIXTURE, "utf8"));
  process.stdout.write(JSON.stringify({ data: { products: { nodes: products.products } } }) + "\\n");
  process.exit(0);
}
process.stderr.write("unexpected\\n");
process.exit(2);
`;
}

async function installFakeShopify(temp) {
  const bin = path.join(temp, "shopify");
  const log = path.join(temp, "shopify-argv.log");
  await writeFile(bin, fakeShopifySource(), "utf8");
  await chmod(bin, 0o755);
  return { bin, log };
}

async function setupGroup(temp, {
  storeType = "preview",
  scopes = ["write_products", "write_themes", "write_publications"],
  scopesOk = true,
  includeConnection = true,
  channelStatus = "online_store_active",
  session = "access_url",
  password = null,
  storeDomain = store,
} = {}) {
  const workdir = path.join(temp, ".workshop");
  const groupDir = path.join(workdir, "A");
  await mkdir(groupDir, { recursive: true });
  await mkdir(path.join(temp, ".git"), { recursive: true });
  if (includeConnection) {
    const connection = {
      store: storeDomain,
      store_name: "Group A Aurora",
      store_type: storeType,
      auth: "cli_cached_admin_token",
      scopes_ok: scopesOk,
      scopes_include: scopes,
      storefront_session: session,
      accessUrl: fixtureAccessUrl,
    };
    if (password) connection.password = password;
    await writeFile(path.join(groupDir, "connection.json"), `${JSON.stringify(connection, null, 2)}\n`, "utf8");
  }
  await writeFile(
    path.join(groupDir, "workshop-state.yaml"),
    `group_id: "A"
store_domain: "${storeDomain}"
mode: "hands_on"

connection:
  status: connected
  store_type: preview
  scopes_ok: true
  auth: cli_cached_admin_token
  storefront_session: ${session}

products:
  source_file: "products.csv"
  imported: 8
  failed: 0
  status: done
  channel_status: ${channelStatus}

brand:
  brief_file: brand-brief.json
  status: done

theme:
  theme_id: 123
  status: unpublished
  preview_url: "https://${storeDomain}/?preview_theme_id=123"
  fallback_used: false

geo:
  evidence_mode: admin_only
  before_score: null
  after_score: 84
  optimizer_status: pending
`,
    "utf8",
  );
  return { workdir, groupDir };
}

function assertNoSecrets(text) {
  assert.equal(text.includes(fixtureAccessUrl), false);
  assert.equal(text.includes("should-not-leak"), false);
  assert.equal(text.includes("hunter2"), false);
  assert.doesNotMatch(text, /access[_-]?url\s*[:=]\s*https?:\/\//i);
  assert.doesNotMatch(text, /onlineStorePasswordProtectionUpdate/);
  assert.doesNotMatch(text, /"password"\s*:/);
}

test("plan does not score, call Shopify, or write the scorecard", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "geo-plan-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const fake = await installFakeShopify(temp);
    const planRun = await runCli(["plan", "--group-id", "A", "--workdir", workdir], temp, {
      SHOPIFY_CLI_BIN: fake.bin,
      SHOPIFY_ARGV_LOG: fake.log,
      FIXTURE_ACCESS_URL: fixtureAccessUrl,
    });
    assert.equal(planRun.code, 0, planRun.stderr);
    const plan = JSON.parse(planRun.stdout);
    assert.equal(plan.ok, true);
    assert.equal(plan.shopify_called, false);
    assert.equal(plan.products_touched, false);
    assert.equal(plan.theme_touched, false);
    assert.equal(plan.mutations, false);
    assert.equal(plan.sample_limit, 10);
    assert.equal(plan.dimensions.length, 5);
    assert.equal(plan.participant_confirm_copy.includes("只读"), true);
    assert.equal(plan.note, "This is a workshop scorecard, not the full diagnostic.");
    await assert.rejects(readFile(path.join(groupDir, "geo.before.json"), "utf8"));
    await assert.rejects(readFile(fake.log, "utf8"));
    const planText = await readFile(path.join(groupDir, "geo.plan.json"), "utf8");
    assertNoSecrets(planText);
    assertNoSecrets(planRun.stdout);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /before_score: null/);
    assert.match(state, /after_score: 84/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("dry-run apply scores fixtures, stays admin_only, and refuses a missing confirm", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "geo-dry-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const fake = await installFakeShopify(temp);
    const env = {
      SHOPIFY_CLI_BIN: fake.bin,
      SHOPIFY_ARGV_LOG: fake.log,
      FIXTURE_ACCESS_URL: fixtureAccessUrl,
    };
    const refused = await runCli(["apply", "--group-id", "A", "--workdir", workdir, "--dry-run"], temp, env);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /--confirm/);
    assert.equal(refused.stderr.includes(fixtureAccessUrl), false);
    await assert.rejects(readFile(path.join(groupDir, "geo.before.json"), "utf8"));

    const applied = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--confirm", "--dry-run"],
      temp,
      env,
    );
    assert.equal(applied.code, 0, applied.stderr);
    const output = JSON.parse(applied.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.dry_run, true);
    assert.equal(output.evidence_mode, "admin_only");
    assert.equal(output.shopify_called, false);
    assert.equal(output.html_fetched, false);
    assert.equal(output.products_touched, false);
    assert.equal(output.theme_touched, false);
    assert.equal(output.mutations, false);
    assert.ok(output.restrictions.includes("html_evidence_skipped"));
    assert.ok(output.sample_size <= 10);
    assert.equal(output.grade, gradeFor(output.geo_score));
    assert.equal(output.skill, "shopify-geo-eval-workshop");
    for (const key of [
      "product_data_completeness",
      "search_findability",
      "ai_understandability",
      "purchase_trust",
      "technical_visibility",
    ]) {
      assert.equal(typeof output.dimensions[key], "number");
    }

    const scoreText = await readFile(path.join(groupDir, "geo.before.json"), "utf8");
    const markdown = await readFile(path.join(groupDir, "geo.before.md"), "utf8");
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assertNoSecrets(scoreText);
    assertNoSecrets(markdown);
    assertNoSecrets(state);
    assertNoSecrets(applied.stdout);
    assert.match(markdown, /workshop scorecard, not the full diagnostic/);
    const scorecard = JSON.parse(scoreText);
    const schema = await loadGeoScoreSchema();
    assert.deepEqual(validateGeoScore(scorecard, schema), []);
    assert.equal(scorecard.products.length, 8);
    assert.equal(scorecard.evidence_mode, "admin_only");
    assert.equal(scorecard.grade, gradeFor(scorecard.geo_score));
    assert.ok(scorecard.geo_score > 0 && scorecard.geo_score < 100);
    assert.match(state, new RegExp(`before_score: ${scorecard.geo_score}`));
    assert.match(state, /evidence_mode: admin_only/);
    assert.match(state, /html_evidence_skipped/);
    assert.match(state, /after_score: 84/);
    assert.match(state, /optimizer_status: pending/);
    assert.match(state, /channel_status: online_store_active/);
    assert.match(state, /preview_url: "https:\/\/aurora-workshop-mvp\.myshopify\.com\/\?preview_theme_id=123"/);
    await assert.rejects(readFile(fake.log, "utf8"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("shell dry-run matches the node entry and caps a 12 product fixture", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "geo-shell-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const fixtures = path.join(temp, "fixtures");
    await mkdir(fixtures);
    const products = Array.from({ length: 12 }, (_, index) => ({
      handle: `workshop-tee-${String(index + 1).padStart(2, "0")}`,
      title: "Tee",
      description: "A shirt.",
      seo: { title: "", description: "" },
      media: [],
      variants: [{ sku: "", price: "10.00" }],
    }));
    await writeFile(
      path.join(fixtures, "admin-products.success.json"),
      `${JSON.stringify({ products }, null, 2)}\n`,
      "utf8",
    );
    const result = await execFileAsync(shellPath, [
      "apply",
      "--group-id",
      "A",
      "--workdir",
      workdir,
      "--confirm",
      "--dry-run",
      "--fixtures-dir",
      fixtures,
    ], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 });
    const output = JSON.parse(result.stdout);
    assert.equal(output.evidence_mode, "admin_only");
    assert.equal(output.sample_size, 10);
    assert.ok(output.restrictions.includes("sample_capped_at_10"));
    assert.equal(output.grade, gradeFor(output.geo_score));
    const scorecard = JSON.parse(await readFile(path.join(groupDir, "geo.before.json"), "utf8"));
    assert.equal(scorecard.products.length, 10);
    assert.equal(scorecard.products[0].handle, "workshop-tee-01");
    assertNoSecrets(result.stdout);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply refuses non-preview stores, password flags, and password fields", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "geo-refuse-"));
  try {
    const dev = await setupGroup(temp, { storeType: "development" });
    const refusedStore = await runCli(
      ["apply", "--group-id", "A", "--workdir", dev.workdir, "--confirm", "--dry-run"],
      temp,
    );
    assert.equal(refusedStore.code, 1);
    assert.match(refusedStore.stderr, /Preview Stores/);
    await assert.rejects(readFile(path.join(dev.groupDir, "geo.before.json"), "utf8"));

    const passwordFlag = await runCli(
      ["apply", "--group-id", "A", "--workdir", dev.workdir, "--confirm", "--dry-run", "--password", "hunter2"],
      temp,
    );
    assert.equal(passwordFlag.code, 1);
    assert.match(passwordFlag.stderr, /password/i);
    assert.equal(passwordFlag.stderr.includes("hunter2"), false);

    const secretDir = await mkdtemp(path.join(os.tmpdir(), "geo-secret-"));
    try {
      const secret = await setupGroup(secretDir, { password: "hunter2" });
      const refusedSecret = await runCli(
        ["apply", "--group-id", "A", "--workdir", secret.workdir, "--confirm", "--dry-run"],
        secretDir,
      );
      assert.equal(refusedSecret.code, 1);
      assert.match(refusedSecret.stderr, /Opening soon password/);
      assert.equal(refusedSecret.stderr.includes("hunter2"), false);
      await assert.rejects(readFile(path.join(secret.groupDir, "geo.before.json"), "utf8"));
    } finally {
      await rm(secretDir, { recursive: true, force: true });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("live read does not persist accessUrl and stays admin_only when HTML fails", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "geo-live-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const fake = await installFakeShopify(temp);
    const productsFixture = path.resolve(__dirname, "../fixtures/admin-products.success.json");
    const applied = await runCli(["apply", "--group-id", "A", "--workdir", workdir, "--confirm"], temp, {
      SHOPIFY_CLI_BIN: fake.bin,
      SHOPIFY_ARGV_LOG: fake.log,
      FIXTURE_ACCESS_URL: fixtureAccessUrl,
      PRODUCTS_FIXTURE: productsFixture,
    });
    assert.equal(applied.code, 0, applied.stderr);
    const output = JSON.parse(applied.stdout);
    assert.equal(output.dry_run, false);
    assert.equal(output.shopify_called, true);
    assert.equal(output.evidence_mode, "admin_only");
    assert.equal(output.html_fetched, false);
    assert.equal(output.products_touched, false);
    assert.equal(output.mutations, false);
    assert.ok(output.restrictions.includes("html_evidence_unavailable") || output.restrictions.includes("unauthenticated_storefront_restricted"));
    assert.equal(output.restrictions.includes("html_evidence_skipped"), false);
    assert.equal(output.grade, gradeFor(output.geo_score));
    const log = await readFile(fake.log, "utf8");
    assert.match(log, /store","execute"/);
    assert.match(log, /store","info"/);
    assert.doesNotMatch(log, /--allow-mutations/);
    const scoreText = await readFile(path.join(groupDir, "geo.before.json"), "utf8");
    const markdown = await readFile(path.join(groupDir, "geo.before.md"), "utf8");
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assertNoSecrets(`${scoreText}\n${markdown}\n${state}\n${applied.stdout}\n${applied.stderr}\n${log}`);
    assert.match(state, /after_score: 84/);
    const scorecard = JSON.parse(scoreText);
    assert.equal(scorecard.products.length <= 10, true);
    assert.equal(scorecard.products.every((product) => product.schema_status === "not_checked"), true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("phase after writes geo.after.json and leaves the before score in place", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "geo-after-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const fake = await installFakeShopify(temp);
    const applied = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--confirm", "--dry-run", "--phase", "after"],
      temp,
      {
        SHOPIFY_CLI_BIN: fake.bin,
        SHOPIFY_ARGV_LOG: fake.log,
        FIXTURE_ACCESS_URL: fixtureAccessUrl,
      },
    );
    assert.equal(applied.code, 0, applied.stderr);
    const output = JSON.parse(applied.stdout);
    assert.equal(output.phase, "after");
    assert.equal(output.mutations, false);
    assert.equal(output.products_touched, false);
    await assert.rejects(readFile(fake.log, "utf8"));
    await assert.rejects(readFile(path.join(groupDir, "geo.before.json"), "utf8"));
    const after = JSON.parse(await readFile(path.join(groupDir, "geo.after.json"), "utf8"));
    const schema = await loadGeoScoreSchema();
    assert.deepEqual(validateGeoScore(after, schema), []);
    assert.equal(after.skill, "shopify-geo-eval-workshop");
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /before_score: null/);
    assert.match(state, new RegExp(`after_score: ${after.geo_score}`));
    assert.match(state, /optimizer_status: pending/);
    assert.match(state, /evidence_mode: admin_only/);
    assertNoSecrets(`${JSON.stringify(after)}\n${state}\n${applied.stdout}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
