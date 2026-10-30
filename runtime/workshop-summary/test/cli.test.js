import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../src/cli.js");
const repoRoot = path.resolve(__dirname, "../../..");
const shellPath = path.join(repoRoot, "scripts/workshop-summary.sh");
const fixtureAccessUrl = "https://preview.example.invalid/access/session-DO-NOT-PERSIST";
const liveStore = "group-a-live.myshopify.com";

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

async function installFakeShopify(dir) {
  const bin = path.join(dir, "shopify");
  await writeFile(
    bin,
    "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$SHOPIFY_ARGV_LOG\"\nexit 9\n",
    "utf8",
  );
  await chmod(bin, 0o755);
  return bin;
}

function assertNoSecrets(text) {
  assert.equal(text.includes(fixtureAccessUrl), false);
  assert.doesNotMatch(text, /access[_-]?url\s*[:=]\s*https?:\/\//i);
  assert.doesNotMatch(text, /onlineStorePasswordProtectionUpdate/);
  assert.doesNotMatch(text, /"(?:access[_-]?url|access[_-]?token|admin[_-]?token|token|secret|password)"\s*:/i);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function connection(storeType = "preview", store = liveStore) {
  return {
    store,
    store_name: "Group A",
    store_type: storeType,
    auth: "cli_cached_admin_token",
    scopes_ok: true,
    scopes_include: ["write_products", "write_themes", "write_publications"],
    storefront_session: "access_url",
    accessUrl: fixtureAccessUrl,
  };
}

async function setupGroup(temp, files = {}) {
  const workdir = path.join(temp, ".workshop");
  const groupDir = path.join(workdir, "A");
  await mkdir(groupDir, { recursive: true });
  await mkdir(path.join(temp, ".git"), { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    if (typeof value === "string") await writeFile(path.join(groupDir, name), value, "utf8");
    else await writeJson(path.join(groupDir, name), value);
  }
  return { workdir, groupDir };
}

test("help and the shell wrapper exit cleanly", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workshop-summary-"));
  try {
    const help = await runCli(["--help"], temp);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /generate_workshop_summary/);
    assert.match(help.stdout, /workshop scorecard, not the full diagnostic/);

    const wrapped = await execFileAsync("bash", [shellPath, "plan", "--version"], { encoding: "utf8" });
    assert.match(wrapped.stdout, /workshop-summary/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply without --confirm is refused and does not write the summary", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workshop-summary-"));
  try {
    const { groupDir } = await setupGroup(temp);
    const result = await runCli(["apply", "--group-dir", groupDir], temp);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--confirm/);
    await assert.rejects(readFile(path.join(groupDir, "workshop-summary.md"), "utf8"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("password flags and a non-preview store are refused", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workshop-summary-"));
  try {
    const { groupDir } = await setupGroup(temp, { "connection.json": connection("preview") });
    const password = await runCli(["apply", "--group-dir", groupDir, "--confirm", "--password", "nope"], temp);
    assert.equal(password.code, 1);
    assert.match(password.stderr, /password/i);

    await writeJson(path.join(groupDir, "connection.json"), connection("development"));
    const store = await runCli(["apply", "--group-dir", groupDir, "--confirm"], temp);
    assert.equal(store.code, 1);
    assert.match(store.stderr, /Preview Store is the only store path/);
    assert.equal(store.stderr.includes(fixtureAccessUrl), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("dry-run on an empty group writes md and html from fixtures", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workshop-summary-"));
  const bin = path.join(temp, "bin");
  await mkdir(bin, { recursive: true });
  const shopifyLog = path.join(temp, "shopify.log");
  await writeFile(shopifyLog, "", "utf8");
  await installFakeShopify(bin);
  try {
    const { groupDir } = await setupGroup(temp);
    const result = await runCli(
      ["apply", "--group-dir", groupDir, "--confirm", "--dry-run"],
      temp,
      { PATH: bin, SHOPIFY_ARGV_LOG: shopifyLog },
    );
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.shopify_called, false);
    assert.equal(payload.summary_status, "demo");
    assert.equal(payload.before_score, 35);
    assert.equal(payload.after_score, 74);
    assert.equal(payload.improvement, 39);
    assert.equal(payload.checklist_complete, true);
    assert.ok(payload.fixture_filled.includes("connection.json"));
    assert.ok(payload.fixture_filled.includes("geo.after.json"));
    assert.equal(await readFile(shopifyLog, "utf8"), "");

    const markdown = await readFile(path.join(groupDir, "workshop-summary.md"), "utf8");
    const html = await readFile(path.join(groupDir, "workshop-summary.html"), "utf8");
    const summary = JSON.parse(await readFile(path.join(groupDir, "workshop-summary.json"), "utf8"));
    assert.match(markdown, /Aurora Skincare/);
    assert.match(markdown, /workshop scorecard, not the full diagnostic/);
    assert.match(markdown, /Product Data Completeness/);
    assert.match(markdown, /- \[x\] Approved P0 changes/);
    assert.match(html, /<h1>Workshop Summary/);
    assert.match(html, /Aurora Skincare daily serum/);
    assert.equal(summary.scores.improvement, 39);
    assert.equal(summary.store_type, "preview");
    for (const text of [result.stdout, markdown, html, JSON.stringify(summary)]) assertNoSecrets(text);
    await assert.rejects(readFile(path.join(groupDir, "geo.after.json"), "utf8"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("dry-run keeps present group files and fills only the gaps", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workshop-summary-"));
  try {
    const { groupDir } = await setupGroup(temp, {
      "connection.json": connection("preview"),
      "brand-brief.json": {
        brand_name: "Live Brand",
        category: "tee",
        selling_points: ["Heavyweight cotton"],
      },
      "workshop-state.yaml": `group_id: "A"
store_domain: "${liveStore}"
mode: "hands_on"

connection:
  status: connected
  store_type: preview
  storefront_session: access_url

geo:
  before_score: 35
  after_score: null
  optimizer_status: pending

qa:
  preview_open: pending
`,
    });
    const result = await runCli(["apply", "--group-dir", groupDir, "--confirm", "--dry-run"], temp);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.store, liveStore);
    assert.ok(payload.fixture_filled.includes("geo.before.json"));
    assert.ok(payload.fixture_filled.includes("geo.after.json"));
    assert.ok(payload.fixture_filled.includes("theme.manifest.json"));
    assert.equal(payload.fixture_filled.includes("brand-brief.json"), false);
    assert.equal(payload.fixture_filled.includes("connection.json"), false);

    const markdown = await readFile(path.join(groupDir, "workshop-summary.md"), "utf8");
    const html = await readFile(path.join(groupDir, "workshop-summary.html"), "utf8");
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(markdown, /\| Name \| Live Brand \|/);
    assert.match(html, /Live Brand · tee/);
    assert.doesNotMatch(markdown, /\| Name \| Aurora Skincare \|/);
    assert.match(markdown, new RegExp(`https://${liveStore.replace(/\./g, "\\.")}/\\?preview_theme_id=123456`));
    assert.match(html, /Live Brand/);
    assert.equal(html.includes(fixtureAccessUrl), false);
    assert.match(state, /status: demo/);
    assert.match(state, /geo:\n {2}before_score: 35\n {2}after_score: null/m);
    assert.match(state, /qa:\n {2}preview_open: pending/);
    assert.equal(state.match(/^summary:/gm).length, 1);
    assertNoSecrets(`${result.stdout}\n${markdown}\n${html}\n${state}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("live apply does not fill fixtures when artifacts are partial", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workshop-summary-"));
  const bin = path.join(temp, "bin");
  await mkdir(bin, { recursive: true });
  const shopifyLog = path.join(temp, "shopify.log");
  await writeFile(shopifyLog, "", "utf8");
  await installFakeShopify(bin);
  try {
    const { groupDir } = await setupGroup(temp, {
      "connection.json": connection("preview"),
      "brand-brief.json": { brand_name: "Live Brand", category: "tee" },
    });
    const plan = await runCli(["plan", "--group-dir", groupDir], temp, { PATH: bin, SHOPIFY_ARGV_LOG: shopifyLog });
    assert.equal(plan.code, 0, plan.stderr);
    await assert.rejects(readFile(path.join(groupDir, "workshop-summary.md"), "utf8"));
    const planDoc = JSON.parse(await readFile(path.join(groupDir, "workshop-summary.plan.json"), "utf8"));
    assert.equal(planDoc.writes_summary, false);
    assert.equal(planDoc.fixture_filled.length, 0);
    assert.match(planDoc.participant_confirm_copy, /Workshop Summary/);

    const result = await runCli(
      ["apply", "--group-dir", groupDir, "--confirm"],
      temp,
      { PATH: bin, SHOPIFY_ARGV_LOG: shopifyLog },
    );
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.dry_run, false);
    assert.equal(payload.summary_status, "done");
    assert.equal(payload.after_score, null);
    assert.deepEqual(payload.fixture_filled, []);
    assert.equal(await readFile(shopifyLog, "utf8"), "");
    const markdown = await readFile(path.join(groupDir, "workshop-summary.md"), "utf8");
    assert.match(markdown, /Live Brand/);
    assert.doesNotMatch(markdown, /Aurora Skincare/);
    assert.match(markdown, /- \[ \] GEO after score/);
    assert.match(payload.gaps.join("\n"), /geo\.after\.json is missing/);
    assertNoSecrets(`${result.stdout}\n${markdown}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("live apply uses group scores instead of the fixture after score", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workshop-summary-"));
  try {
    const before = {
      store: liveStore,
      geo_score: 40,
      grade: "D",
      evidence_mode: "admin_only",
      restrictions: ["html_evidence_skipped"],
      dimensions: {
        product_data_completeness: 40,
        search_findability: 40,
        ai_understandability: 40,
        purchase_trust: 40,
        technical_visibility: 40,
      },
      products: [{ handle: "tee", score: 40 }],
      skill: "shopify-geo-eval-workshop",
    };
    const after = {
      ...before,
      geo_score: 81,
      grade: "A",
      dimensions: {
        product_data_completeness: 90,
        search_findability: 88,
        ai_understandability: 80,
        purchase_trust: 70,
        technical_visibility: 40,
      },
    };
    const { groupDir } = await setupGroup(temp, {
      "connection.json": connection("preview"),
      "products.import.result.json": { imported: 8, failed: 0 },
      "products.channel.json": { channel_status: "online_store_active", theme_published: false },
      "brand-brief.json": { brand_name: "Live Brand", category: "tee" },
      "theme.manifest.json": {
        theme_id: 77,
        status: "unpublished",
        preview_url: `https://${liveStore}/?preview_theme_id=77`,
        fallback_used: false,
      },
      "geo.before.json": before,
      "geo.proposal.json": { suggestions: [{ handle: "tee", field: "faq", priority: "P1" }] },
      "geo.approved.json": {
        suggestions: [{ handle: "tee", field: "title", before: "Tee", after: "Live Brand tee", priority: "P0" }],
      },
      "geo.after.json": after,
    });
    const result = await runCli(["apply", "--group-dir", groupDir, "--confirm"], temp);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.before_score, 40);
    assert.equal(payload.after_score, 81);
    assert.equal(payload.improvement, 41);
    assert.equal(payload.checklist_complete, true);
    assert.deepEqual(payload.fixture_filled, []);
    assert.equal(payload.summary_status, "done");
    const markdown = await readFile(path.join(groupDir, "workshop-summary.md"), "utf8");
    assert.match(markdown, /81 \(A\)/);
    assert.doesNotMatch(markdown, /74 \(B\)/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("a non-workshop scorecard is refused even on dry-run", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workshop-summary-"));
  try {
    const { groupDir } = await setupGroup(temp, {
      "connection.json": connection("preview"),
      "geo.before.json": {
        skill: "shopify-geo-eval",
        engine_scoring: true,
        geo_score: 10,
        dimensions: { G1: 1 },
      },
    });
    const result = await runCli(["apply", "--group-dir", groupDir, "--confirm", "--dry-run"], temp);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /shopify-geo-eval-workshop/);
    assert.match(result.stderr, /not the full diagnostic/);
    assert.equal(result.stderr.includes(fixtureAccessUrl), false);
    await assert.rejects(readFile(path.join(groupDir, "workshop-summary.md"), "utf8"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("the shell wrapper plans a group without writing the summary pages", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workshop-summary-"));
  try {
    const { groupDir } = await setupGroup(temp, { "connection.json": connection("preview") });
    const result = await execFileAsync(
      "bash",
      [shellPath, "plan", "--group-dir", groupDir, "--dry-run"],
      { cwd: repoRoot, encoding: "utf8", timeout: 30_000 },
    );
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "plan");
    assert.equal(payload.writes_summary, false);
    assert.equal(payload.shopify_called, false);
    assert.ok(payload.continuations.some((item) => item.command.includes("workshop-summary.sh apply")));
    await assert.rejects(readFile(path.join(groupDir, "workshop-summary.html"), "utf8"));
    assertNoSecrets(result.stdout);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
