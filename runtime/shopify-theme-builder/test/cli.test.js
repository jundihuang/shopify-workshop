import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../src/cli.js");
const fixtureAccessUrl = "https://preview.example.invalid/access/session-DO-NOT-PERSIST";
const store = "aurora-workshop-mvp.myshopify.com";

const BRIEF = {
  brand_name: "Aurora Skincare",
  tagline: "A short routine for everyday skin.",
  positioning: "Aurora Skincare keeps the routine short.",
  tone: { voice: "calm", avoid: ["medical claims"] },
  visual: { logo: "", primary_color: "#1F4E5F", secondary_color: "#F3EDE4" },
  selling_points: ["A three-step morning and evening routine"],
  trust_signals: ["Full ingredient list on every product"],
  pages: {
    home: { intent: "Introduce the brand." },
    collection: { intent: "Help shoppers scan Aurora products by routine step." },
    product: { intent: "Explain one product with specific, non-medical copy." },
  },
  locale: "en-US",
  currency: "USD",
};

async function runCli(args, cwd, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, SHOPWRIGHT_DEMO_THEME_ID: "", ...env },
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
if (args.includes("publish") || args.includes("dev") || args.includes("--live") || args.includes("development")) {
  process.stderr.write("forbidden\\n");
  process.exit(3);
}
const mode = process.env.SHOPIFY_FAKE_MODE || "ok";
const help = args.includes("--help");
if (args[0] === "theme" && args[1] === "push" && help) {
  process.stdout.write(mode === "share"
    ? "Usage: theme push --json --store --path\\n"
    : "Usage: theme push --unpublished --json --store --path\\n");
  process.exit(0);
}
if (args[0] === "theme" && args[1] === "share" && help) {
  process.stdout.write("Usage: theme share --json --store --path\\n");
  process.exit(0);
}
if (mode === "fail") {
  process.stderr.write("push failed accessUrl=${fixtureAccessUrl}\\n");
  process.exit(1);
}
const id = mode === "share" ? 770000333 : 770000222;
process.stdout.write(JSON.stringify({
  theme: {
    id: id,
    name: "ShopWright Workshop Skeleton",
    role: "unpublished",
    shop: "evil.example",
    preview_url: "http://127.0.0.1:9292/?preview_theme_id=" + id + "&password=nope",
    editor_url: "https://evil.example/admin/themes/" + id,
    accessUrl: ${JSON.stringify(fixtureAccessUrl)}
  }
}) + "\\n");
`;
}

async function setupGroup(temp, {
  storeType = "preview",
  scopes = ["write_products", "write_themes", "write_publications"],
  scopesOk = true,
  includeConnection = true,
  includeBrief = true,
  brief = BRIEF,
  storeDomain = store,
} = {}) {
  const workdir = path.join(temp, ".workshop");
  const groupDir = path.join(workdir, "A");
  await mkdir(groupDir, { recursive: true });
  await mkdir(path.join(temp, ".git"), { recursive: true });
  if (includeConnection) {
    await writeFile(
      path.join(groupDir, "connection.json"),
      `${JSON.stringify({
        store: storeDomain,
        store_name: "Group A Aurora",
        store_type: storeType,
        auth: "cli_cached_admin_token",
        scopes_ok: scopesOk,
        scopes_include: scopes,
        storefront_session: "access_url",
        accessUrl: fixtureAccessUrl,
      }, null, 2)}\n`,
      "utf8",
    );
  }
  if (includeBrief) {
    await writeFile(path.join(groupDir, "brand-brief.json"), `${JSON.stringify(brief, null, 2)}\n`, "utf8");
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
  storefront_session: access_url

products:
  source_file: "products.csv"
  imported: 8
  failed: 0
  status: done
  channel_status: draft

brand:
  brief_file: brand-brief.json
  status: done
  source: student

theme:
  theme_id: null
  status: none
  preview_url: null
  fallback_used: false
  note: kept

geo:
  evidence_mode: admin_only
  optimizer_status: pending
`,
    "utf8",
  );
  return { workdir, groupDir };
}

function assertNoSecrets(text) {
  assert.equal(text.includes(fixtureAccessUrl), false);
  assert.doesNotMatch(text, /access[_-]?url\s*[:=]\s*https?:\/\//i);
  assert.doesNotMatch(text, /127\.0\.0\.1/);
  assert.doesNotMatch(text, /password=nope/);
  assert.doesNotMatch(text, /evil\.example/);
  assert.doesNotMatch(text, /theme\s+publish\b/);
  assert.doesNotMatch(text, /theme\s+dev\b/);
  assert.doesNotMatch(text, /--live\b/);
}

test("plan summarizes the fill and does not push or write a manifest", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "theme-builder-plan-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const planRun = await runCli(["plan", "--group-id", "A", "--workdir", workdir], temp);
    assert.equal(planRun.code, 0, planRun.stderr);
    assert.equal(planRun.stderr, "");
    const plan = JSON.parse(planRun.stdout);
    assert.equal(plan.ok, true);
    assert.equal(plan.shopify_called, false);
    assert.equal(plan.writes_manifest, false);
    assert.equal(plan.theme_publish_invoked, false);
    assert.equal(plan.products_touched, false);
    assert.equal(plan.channel_status_changed, false);
    assert.equal(plan.planned_command, "shopify theme push --unpublished --json");
    assert.equal(plan.fill.brand_name, "Aurora Skincare");
    assert.equal(plan.fill.primary_color, "#1F4E5F");
    assert.deepEqual(plan.pages, ["home", "collection", "product"]);
    assert.equal(plan.participant_confirm_copy, "「填充骨架并 push 为 Unpublished Theme（不发布主题，不改商品渠道）」");
    assert.equal(plan.preview_url_shape, `https://${store}/?preview_theme_id={id}`);
    assert.ok(plan.sections.some((section) => section.page === "home" && section.id === "hero"));

    const planText = await readFile(path.join(groupDir, "theme.plan.json"), "utf8");
    assertNoSecrets(planText);
    assertNoSecrets(planRun.stdout);
    await assert.rejects(readFile(path.join(groupDir, "theme.manifest.json"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(path.join(groupDir, "theme-work", "config", "settings_data.json"), "utf8"), /ENOENT/);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /theme_id: null/);
    assert.match(state, /status: none/);
    assert.match(state, /channel_status: draft/);
    assert.match(state, /source: student/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply refuses without --confirm, including dry-run, and writes nothing", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "theme-builder-confirm-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const refused = await runCli(["apply", "--group-id", "A", "--workdir", workdir], temp);
    assert.notEqual(refused.code, 0);
    assert.match(JSON.parse(refused.stderr).error, /without --confirm/i);

    const refusedDryRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--dry-run"],
      temp,
    );
    assert.notEqual(refusedDryRun.code, 0);
    assert.match(JSON.parse(refusedDryRun.stderr).error, /without --confirm/i);
    await assert.rejects(readFile(path.join(groupDir, "theme.manifest.json"), "utf8"), /ENOENT/);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /theme_id: null/);
    assert.match(state, /channel_status: draft/);
    assert.match(state, /status: done/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("dry-run apply writes the fixture manifest and preserves connection, products, and brand", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "theme-builder-dry-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const applyRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--dry-run", "--confirm"],
      temp,
    );
    assert.equal(applyRun.code, 0, applyRun.stderr);
    const output = JSON.parse(applyRun.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.dry_run, true);
    assert.equal(output.demo, false);
    assert.equal(output.shopify_called, false);
    assert.equal(output.theme_publish_invoked, false);
    assert.equal(output.products_touched, false);
    assert.equal(output.channel_status_changed, false);
    assert.equal(output.theme_id, 880000111);
    assert.equal(output.status, "unpublished");
    assert.equal(output.fallback_used, false);
    assert.equal(output.preview_url, `https://${store}/?preview_theme_id=880000111`);
    assert.deepEqual(output.pages, ["home", "collection", "product"]);
    assert.equal(output.fixture_used, "fixtures/theme-push.unpublished.success.json");
    assert.equal(output.upload_strategy, "push");

    const manifestText = await readFile(path.join(groupDir, "theme.manifest.json"), "utf8");
    const manifest = JSON.parse(manifestText);
    assert.equal(manifest.fake, true);
    assert.equal(manifest.live_theme_touched, false);
    assert.equal(manifest.fill.primary_color, "#1F4E5F");
    assertNoSecrets(manifestText);
    assertNoSecrets(applyRun.stdout);

    const settings = JSON.parse(await readFile(path.join(groupDir, "theme-work", "config", "settings_data.json"), "utf8"));
    assert.equal(settings.current.color_primary, "#1F4E5F");
    assert.equal(settings.current.brand_name, "Aurora Skincare");

    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /theme_id: 880000111/);
    assert.match(state, /status: unpublished/);
    assert.match(state, new RegExp(`preview_url: "https://${store.replace(".", "\\.")}/\\?preview_theme_id=880000111"`));
    assert.match(state, /fallback_used: false/);
    assert.match(state, /note: kept/);
    assert.match(state, /store_type: preview/);
    assert.match(state, /channel_status: draft/);
    assert.match(state, /brief_file: brand-brief\.json/);
    assert.match(state, /status: done/);
    assert.match(state, /source: student/);
    assert.match(state, /optimizer_status: pending/);
    assertNoSecrets(state);
    await assert.rejects(readFile(path.join(groupDir, "products.channel.json"), "utf8"), /ENOENT/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("demo apply attaches the documented Demo Theme and can override its id", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "theme-builder-demo-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const applyRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--demo", "--confirm"],
      temp,
    );
    assert.equal(applyRun.code, 0, applyRun.stderr);
    const output = JSON.parse(applyRun.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.demo, true);
    assert.equal(output.dry_run, false);
    assert.equal(output.shopify_called, false);
    assert.equal(output.fallback_used, true);
    assert.equal(output.status, "fallback");
    assert.equal(output.theme_id, 900000001);
    assert.equal(output.preview_url, `https://${store}/?preview_theme_id=900000001`);
    assert.equal(output.fixture_used, "templates/theme.manifest.demo.json");
    assert.equal(output.products_touched, false);
    const manifestText = await readFile(path.join(groupDir, "theme.manifest.json"), "utf8");
    assert.equal(manifestText.includes("demo-theme.myshopify.com"), false);
    assertNoSecrets(manifestText);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /status: fallback/);
    assert.match(state, /fallback_used: true/);
    assert.match(state, /channel_status: draft/);
    assert.match(state, /status: done/);
    assert.match(state, /source: student/);
    await assert.rejects(readFile(path.join(groupDir, "theme-work", "config", "settings_data.json"), "utf8"), /ENOENT/);

    const override = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--demo", "--dry-run", "--confirm"],
      temp,
      { SHOPWRIGHT_DEMO_THEME_ID: "900000777" },
    );
    assert.equal(override.code, 0, override.stderr);
    const overridden = JSON.parse(override.stdout);
    assert.equal(overridden.shopify_called, false);
    assert.equal(overridden.theme_id, 900000777);
    assert.equal(overridden.preview_url, `https://${store}/?preview_theme_id=900000777`);
    assert.equal(overridden.fallback_used, true);
    assert.equal(overridden.status, "fallback");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("refuses a non-preview store, a missing brief, a missing connection, and accessUrl in the brief", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "theme-builder-refuse-"));
  try {
    const devStore = await setupGroup(temp, { storeType: "development" });
    const refusedStore = await runCli(["plan", "--group-id", "A", "--workdir", devStore.workdir], temp);
    assert.notEqual(refusedStore.code, 0);
    assert.match(JSON.parse(refusedStore.stderr).error, /only Preview Stores are allowed/);
    assert.doesNotMatch(JSON.parse(refusedStore.stderr).error, /Dev Store fallback|production fallback/i);

    const missingBrief = await setupGroup(path.join(temp, "brief"), { includeBrief: false });
    const refusedBrief = await runCli(["plan", "--group-id", "A", "--workdir", missingBrief.workdir], temp);
    assert.notEqual(refusedBrief.code, 0);
    assert.match(JSON.parse(refusedBrief.stderr).error, /Brand brief not found/);

    const missingConnection = await setupGroup(path.join(temp, "connection"), { includeConnection: false });
    const refusedConnection = await runCli(
      ["plan", "--group-id", "A", "--workdir", missingConnection.workdir],
      temp,
    );
    assert.notEqual(refusedConnection.code, 0);
    assert.match(JSON.parse(refusedConnection.stderr).error, /connection not found/i);

    const leaked = await setupGroup(path.join(temp, "leak"), {
      brief: { ...BRIEF, accessUrl: fixtureAccessUrl },
    });
    const refusedLeak = await runCli(
      ["apply", "--group-id", "A", "--workdir", leaked.workdir, "--confirm", "--dry-run"],
      temp,
    );
    assert.notEqual(refusedLeak.code, 0);
    assert.match(JSON.parse(refusedLeak.stderr).error, /accessUrl/);
    await assert.rejects(readFile(path.join(leaked.groupDir, "theme.manifest.json"), "utf8"), /ENOENT/);
    const state = await readFile(path.join(leaked.groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /theme_id: null/);
    assert.equal(state.includes(fixtureAccessUrl), false);
    assertNoSecrets(refusedLeak.stderr);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("a real apply records unpublished push args and rewrites the preview URL", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "theme-builder-push-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const fakePath = path.join(temp, "fake-shopify.js");
    const argvLog = path.join(temp, "shopify-argv.log");
    await writeFile(fakePath, fakeShopifySource(), { mode: 0o755 });

    const applyRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--confirm"],
      temp,
      { SHOPIFY_CLI_BIN: fakePath, SHOPIFY_ARGV_LOG: argvLog, SHOPIFY_FAKE_MODE: "ok" },
    );
    assert.equal(applyRun.code, 0, applyRun.stderr);
    const output = JSON.parse(applyRun.stdout);
    assert.equal(output.shopify_called, true);
    assert.equal(output.dry_run, false);
    assert.equal(output.fallback_used, false);
    assert.equal(output.status, "unpublished");
    assert.equal(output.theme_id, 770000222);
    assert.equal(output.preview_url, `https://${store}/?preview_theme_id=770000222`);
    assert.equal(output.upload_strategy, "push");
    assert.equal(output.theme_publish_invoked, false);

    const calls = (await readFile(argvLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(calls.some((args) => args.includes("publish") || args.includes("dev") || args.includes("--live")), false);
    const upload = calls.find((args) => args[0] === "theme" && args[1] === "push" && !args.includes("--help"));
    assert.ok(upload);
    assert.equal(upload.includes("--unpublished"), true);
    assert.equal(upload.includes("--json"), true);
    assert.equal(upload.includes(store), true);

    const manifestText = await readFile(path.join(groupDir, "theme.manifest.json"), "utf8");
    assertNoSecrets(manifestText);
    assertNoSecrets(applyRun.stdout);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /theme_id: 770000222/);
    assert.match(state, /status: unpublished/);
    assert.match(state, /channel_status: draft/);
    assert.match(state, /source: student/);
    assertNoSecrets(state);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("push failure attaches the Demo Theme and theme share is only a fallback strategy", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "theme-builder-fallback-"));
  try {
    const failed = await setupGroup(temp);
    const fakePath = path.join(temp, "fake-shopify.js");
    const failLog = path.join(temp, "fail-argv.log");
    await writeFile(fakePath, fakeShopifySource(), { mode: 0o755 });
    const failRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", failed.workdir, "--confirm"],
      temp,
      { SHOPIFY_CLI_BIN: fakePath, SHOPIFY_ARGV_LOG: failLog, SHOPIFY_FAKE_MODE: "fail" },
    );
    assert.equal(failRun.code, 0, failRun.stderr);
    const failedOutput = JSON.parse(failRun.stdout);
    assert.equal(failedOutput.shopify_called, true);
    assert.equal(failedOutput.fallback_used, true);
    assert.equal(failedOutput.status, "fallback");
    assert.equal(failedOutput.theme_id, 900000001);
    assert.equal(failedOutput.preview_url, `https://${store}/?preview_theme_id=900000001`);
    assert.equal(failedOutput.fallback_reason, "push_failed");
    assert.equal(failedOutput.products_touched, false);
    const failManifest = await readFile(path.join(failed.groupDir, "theme.manifest.json"), "utf8");
    assertNoSecrets(failManifest);
    assertNoSecrets(failRun.stdout);
    const failState = await readFile(path.join(failed.groupDir, "workshop-state.yaml"), "utf8");
    assert.match(failState, /status: fallback/);
    assert.match(failState, /fallback_used: true/);
    assert.match(failState, /channel_status: draft/);
    assert.match(failState, /status: done/);
    assertNoSecrets(failState);
    const failCalls = (await readFile(failLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(failCalls.some((args) => args.includes("publish") || args.includes("dev") || args.includes("--live")), false);

    const shared = await setupGroup(path.join(temp, "share"));
    const shareLog = path.join(temp, "share-argv.log");
    const shareRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", shared.workdir, "--confirm"],
      temp,
      { SHOPIFY_CLI_BIN: fakePath, SHOPIFY_ARGV_LOG: shareLog, SHOPIFY_FAKE_MODE: "share" },
    );
    assert.equal(shareRun.code, 0, shareRun.stderr);
    const shareOutput = JSON.parse(shareRun.stdout);
    assert.equal(shareOutput.upload_strategy, "share");
    assert.equal(shareOutput.status, "unpublished");
    assert.equal(shareOutput.theme_id, 770000333);
    assert.equal(shareOutput.preview_url, `https://${store}/?preview_theme_id=770000333`);
    assert.equal(shareOutput.fallback_used, false);
    const shareCalls = (await readFile(shareLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(shareCalls.some((args) => args[1] === "push" && args.includes("--unpublished")), false);
    const shareUpload = shareCalls.find((args) => args[1] === "share" && !args.includes("--help"));
    assert.ok(shareUpload);
    assert.equal(shareUpload.includes("--json"), true);
    assert.equal(shareCalls.some((args) => args.includes("publish") || args.includes("dev") || args.includes("--live")), false);
    assertNoSecrets(await readFile(path.join(shared.groupDir, "theme.manifest.json"), "utf8"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
