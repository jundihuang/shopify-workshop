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

async function runCli(args, cwd) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd,
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

async function setupGroup(temp, {
  storeType = "preview",
  scopes = ["write_products", "write_themes", "write_publications"],
  scopesOk = true,
  includeConnection = true,
  includeResult = true,
} = {}) {
  const workdir = path.join(temp, ".workshop");
  const groupDir = path.join(workdir, "A");
  await mkdir(groupDir, { recursive: true });
  await mkdir(path.join(temp, ".git"), { recursive: true });
  if (includeConnection) {
    await writeFile(
      path.join(groupDir, "connection.json"),
      `${JSON.stringify(
        {
          store: "aurora-workshop-mvp.myshopify.com",
          store_name: "Group A Aurora",
          store_type: storeType,
          auth: "cli_cached_admin_token",
          scopes_ok: scopesOk,
          scopes_include: scopes,
          storefront_session: "access_url",
          accessUrl: fixtureAccessUrl,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  if (includeResult) {
    await writeFile(
      path.join(groupDir, "products.import.result.json"),
      `${JSON.stringify(
        {
          schema_version: "1.0",
          artifact: "products.import.result.json",
          store: "aurora-workshop-mvp.myshopify.com",
          default_status: "draft",
          results: [
            {
              ok: true,
              product_id: "gid://shopify/Product/9000001001",
              handle: "soft-touch-100-cotton-blank-t-shirt-inflation-streetwear",
              title: "Heavyweight Cotton Oversized T-Shirt",
              sku: "265SS187S",
              shopify_status: "draft",
            },
            {
              ok: true,
              product_id: "gid://shopify/Product/9000001002",
              handle: "boxy-camo-tees-inflation-streetwear",
              title: "Boxy Camo Tees",
              sku: "S26012712M",
              shopify_status: "draft",
            },
            {
              ok: false,
              handle: "failed-product",
              error: "fixture failed",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  await writeFile(
    path.join(groupDir, "workshop-state.yaml"),
    `group_id: "A"
store_domain: "aurora-workshop-mvp.myshopify.com"
mode: "demo"

connection:
  status: connected
  store_type: preview
  scopes_ok: true
  auth: cli_cached_admin_token
  storefront_session: access_url

products:
  source_file: "products.csv"
  imported: 2
  failed: 0
  status: done
  channel_status: draft

theme:
  theme_id: 123
  status: unpublished
  preview_url: "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=123"
`,
    "utf8",
  );
  return { workdir, groupDir };
}

test("plan parses import results and dry-run writes fixture channel + state artifacts safely", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "publish-products-cli-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const planRun = await runCli(["plan", "--group-id", "A", "--workdir", workdir], temp);
    assert.equal(planRun.code, 0, planRun.stderr);
    assert.equal(planRun.stderr, "");
    const planOutput = JSON.parse(planRun.stdout);
    assert.equal(planOutput.ok, true);
    assert.equal(planOutput.source, "products.import.result.json");
    assert.deepEqual(planOutput.product_ids, [
      "gid://shopify/Product/9000001001",
      "gid://shopify/Product/9000001002",
    ]);
    assert.equal(planOutput.participant_confirm_copy, "「为 GEO 演示：发布商品到 Online Store（主题仍不发布）」");
    assert.match(planOutput.risk_one_liner, /Online Store/);
    assert.equal(planOutput.theme.touched, false);
    assert.equal(planOutput.theme.published, false);

    const planText = await readFile(path.join(groupDir, "products.channel.plan.json"), "utf8");
    assert.equal(planText.includes(fixtureAccessUrl), false);

    const applyRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--dry-run", "--confirm"],
      temp,
    );
    assert.equal(applyRun.code, 0, applyRun.stderr);
    assert.equal(applyRun.stderr, "");
    const applyOutput = JSON.parse(applyRun.stdout);
    assert.equal(applyOutput.ok, true);
    assert.equal(applyOutput.dry_run, true);
    assert.equal(applyOutput.shopify_status, "active");
    assert.equal(applyOutput.channels_published, true);
    assert.equal(applyOutput.state_updated, true);
    assert.equal(applyOutput.fixture_used, "fixtures/channel-publish.success.json");
    assert.equal(applyOutput.theme.touched, false);
    assert.equal(applyOutput.theme.published, false);

    const channelText = await readFile(path.join(groupDir, "products.channel.json"), "utf8");
    const channel = JSON.parse(channelText);
    assert.equal(channel.fake, true);
    assert.equal(channel.dry_run, true);
    assert.equal(channel.theme.touched, false);
    assert.equal(channel.theme.published, false);
    assert.equal(channel.summary.planned, 2);
    assert.equal(channel.summary.published, 2);
    assert.deepEqual(
      channel.products.map((product) => product.product_id),
      ["gid://shopify/Product/9000001001", "gid://shopify/Product/9000001002"],
    );

    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /channel_status: online_store_active/);
    assert.match(state, /theme:\n  theme_id: 123\n  status: unpublished/);

    for (const text of [planRun.stdout, applyRun.stdout, planText, channelText, state]) {
      assert.equal(text.includes(fixtureAccessUrl), false);
      assert.doesNotMatch(text, /"access[_-]?url"\s*:/i);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply refuses to run without --confirm before writing artifacts", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "publish-products-no-confirm-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const result = await runCli(["apply", "--group-id", "A", "--workdir", workdir], temp);
    assert.notEqual(result.code, 0);
    assert.match(JSON.parse(result.stderr).error, /without --confirm/i);
    await assert.rejects(readFile(path.join(groupDir, "products.channel.json"), "utf8"), /ENOENT/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("refuses non-preview stores and missing write scopes", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "publish-products-safety-"));
  try {
    const nonPreview = await setupGroup(temp, { storeType: "development" });
    const nonPreviewRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", nonPreview.workdir, "--dry-run", "--confirm"],
      temp,
    );
    assert.notEqual(nonPreviewRun.code, 0);
    assert.match(JSON.parse(nonPreviewRun.stderr).error, /only Preview Stores are allowed/i);

    const missingScope = await setupGroup(temp, { scopes: ["write_products"] });
    const missingScopeRun = await runCli(
      ["plan", "--group-id", "A", "--workdir", missingScope.workdir],
      temp,
    );
    assert.notEqual(missingScopeRun.code, 0);
    assert.match(JSON.parse(missingScopeRun.stderr).error, /write_publications/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("dry-run plan and apply can use the Draft-product fallback when import result is missing", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "publish-products-fallback-"));
  try {
    const { workdir } = await setupGroup(temp, { includeResult: false });
    const planRun = await runCli(
      ["plan", "--group-id", "A", "--workdir", workdir, "--dry-run"],
      temp,
    );
    assert.equal(planRun.code, 0, planRun.stderr);
    const plan = JSON.parse(planRun.stdout);
    assert.equal(plan.source, "admin_draft_products_fixture");
    assert.equal(plan.products.length, 2);
    assert.deepEqual(plan.product_ids, [
      "gid://shopify/Product/9000001001",
      "gid://shopify/Product/9000001002",
    ]);

    const applyRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--dry-run", "--confirm"],
      temp,
    );
    assert.equal(applyRun.code, 0, applyRun.stderr);
    assert.equal(JSON.parse(applyRun.stdout).summary.published, 2);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("explicit --product-id list limits publishing to those ids", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "publish-products-explicit-"));
  try {
    const { workdir } = await setupGroup(temp);
    const planRun = await runCli(
      [
        "plan",
        "--group-id",
        "A",
        "--workdir",
        workdir,
        "--product-id",
        "gid://shopify/Product/5550000001",
        "--product-id",
        "5550000002",
      ],
      temp,
    );
    assert.equal(planRun.code, 0, planRun.stderr);
    const plan = JSON.parse(planRun.stdout);
    assert.equal(plan.source, "explicit_product_ids");
    assert.deepEqual(plan.product_ids, [
      "gid://shopify/Product/5550000001",
      "gid://shopify/Product/5550000002",
    ]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
