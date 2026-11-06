import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../src/cli.js");

const CONNECTION = {
  store: "workshop-fixture.myshopify.com",
  store_name: "Fixture Group",
  store_type: "preview",
  auth: "cli_cached_admin_token",
  scopes_ok: true,
  scopes_include: ["write_products", "write_themes", "write_publications"],
  storefront_session: "access_url",
};

async function setupGroup(root, groupId = "A") {
  const workdir = path.join(root, "ws");
  const groupDir = path.join(workdir, groupId);
  await mkdir(groupDir, { recursive: true });
  await writeFile(path.join(groupDir, "connection.json"), `${JSON.stringify(CONNECTION, null, 2)}\n`);
  await writeFile(
    path.join(groupDir, "workshop-state.yaml"),
    [
      'group_id: "A"',
      'store_domain: "workshop-fixture.myshopify.com"',
      "connection:",
      "  status: connected",
      "  store_type: preview",
      "products:",
      "  channel_status: online_store_active",
      "theme:",
      "  status: unpublished",
      "summary:",
      "  status: done",
      "",
    ].join("\n"),
  );
  return { workdir, groupDir };
}

async function runCli(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, SHOPIFY_CLI_BIN: "shopify-definitely-missing" },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function assertNoSecrets(text) {
  assert.doesNotMatch(text, /access[_-]?url\s*[:=]\s*https?:\/\//i, "no raw accessUrl");
  assert.doesNotMatch(text, /"(?:access[_-]?url|admin[_-]?token|password)"\s*:/i, "no credential fields");
}

test("plan --dry-run writes banner.plan.json and never calls Shopify", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "banner-plan-"));
  try {
    const { workdir } = await setupGroup(temp);
    const run = await runCli(["plan", "--group-id", "A", "--workdir", workdir, "--dry-run"], temp);
    assert.equal(run.code, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.shopify_called, false);
    assert.equal(output.writes_template, false);
    assert.match(output.hero_section, /^hero_/);
    assert.equal(output.image_1_current, null);
    assert.match(output.participant_confirm_copy, /Horizon/);

    const planFile = await readFile(path.join(workdir, "A", "banner.plan.json"), "utf8");
    assertNoSecrets(planFile);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply refuses to run without --confirm", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "banner-noconfirm-"));
  try {
    const { workdir } = await setupGroup(temp);
    const run = await runCli(["apply", "--group-id", "A", "--workdir", workdir, "--dry-run"], temp);
    assert.notEqual(run.code, 0);
    const err = JSON.parse(run.stderr);
    assert.match(err.error, /--confirm/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply --confirm --dry-run writes install result, backup, and banner state without Shopify", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "banner-apply-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const run = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--confirm", "--dry-run"],
      temp,
    );
    assert.equal(run.code, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.dry_run, true);
    assert.equal(output.shopify_called, false);
    assert.equal(output.verified, "fixture");
    assert.match(output.image_ref, /^shopify:\/\/shop_images\//);
    assert.equal(output.copy_after.heading, "<p>Heavyweight tees, broken in from day one.</p>");
    assert.equal(output.copy_after.button_label, "Shop the collection");

    const resultFile = await readFile(path.join(groupDir, "banner.install.json"), "utf8");
    assertNoSecrets(resultFile);

    const backup = await readFile(path.join(groupDir, "horizon-index.backup.json"), "utf8");
    assert.match(backup.slice(0, 40), /^\/\*/);

    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /banner:/);
    assert.match(state, /status: done/);
    assert.match(state, /image_ref: "shopify:\/\/shop_images\//);
    assert.match(state, /live_theme_modified: true/);
    assert.match(state, /channel_status: online_store_active/, "products section preserved");
    assert.match(state, /status: unpublished/, "theme section preserved");
    assert.match(state, /status: done/, "summary section preserved");
    assertNoSecrets(state);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("restore --confirm --dry-run works from the written backup", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "banner-restore-"));
  try {
    const { workdir } = await setupGroup(temp);
    await runCli(["apply", "--group-id", "A", "--workdir", workdir, "--confirm", "--dry-run"], temp);
    const run = await runCli(["restore", "--group-id", "A", "--workdir", workdir, "--confirm", "--dry-run"], temp);
    assert.equal(run.code, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.dry_run, true);

    const state = await readFile(path.join(workdir, "A", "workshop-state.yaml"), "utf8");
    assert.match(state, /banner:/);
    assert.match(state, /status: restored/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply --confirm --dry-run honors custom heading and button copy", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "banner-copy-"));
  try {
    const { workdir } = await setupGroup(temp);
    const run = await runCli(
      [
        "apply", "--group-id", "A", "--workdir", workdir, "--confirm", "--dry-run",
        "--heading", "Oversized. Washed. Worn in.",
        "--button-label", "See the tees",
      ],
      temp,
    );
    assert.equal(run.code, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.copy_after.heading, "<p>Oversized. Washed. Worn in.</p>");
    assert.equal(output.copy_after.button_label, "See the tees");
    assert.notEqual(output.copy_before.heading, output.copy_after.heading);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("restore without a backup fails with a clear error", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "banner-restore-none-"));
  try {
    const { workdir } = await setupGroup(temp);
    const run = await runCli(["restore", "--group-id", "A", "--workdir", workdir, "--confirm", "--dry-run"], temp);
    assert.notEqual(run.code, 0);
    const err = JSON.parse(run.stderr);
    assert.match(err.error, /No backup found/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("non-preview connections are refused", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "banner-notpreview-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const bad = { ...CONNECTION, store_type: "production" };
    await writeFile(path.join(groupDir, "connection.json"), `${JSON.stringify(bad)}\n`);
    const run = await runCli(["plan", "--group-id", "A", "--workdir", workdir, "--dry-run"], temp);
    assert.notEqual(run.code, 0);
    const err = JSON.parse(run.stderr);
    assert.match(err.error, /preview/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
