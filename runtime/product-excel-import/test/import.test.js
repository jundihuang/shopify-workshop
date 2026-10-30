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

async function setupGroup(temp, { storeType = "preview", includeConnection = true } = {}) {
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
          scopes_ok: true,
          scopes_include: ["write_products", "write_themes", "write_publications"],
          storefront_session: "access_url",
          // A malformed/legacy artifact must never leak this value into output.
          accessUrl: fixtureAccessUrl,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  const csvPath = path.join(temp, "products.csv");
  await writeFile(
    csvPath,
    `handle,title,description,product_type,price,sku,image_url,source_url
sample-one,First Product,A description,T-Shirt,19.99,SKU-1,https://example.com/one.jpg,https://source.example/one
sample-two,Second Product,Another description,T-Shirt,29.99,SKU-2,https://example.com/two.jpg,https://source.example/two
`,
    "utf8",
  );
  return { workdir, groupDir, csvPath };
}

test("dry-run writes preview and fake result artifacts without leaking accessUrl", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "product-import-cli-"));
  try {
    const { workdir, groupDir, csvPath } = await setupGroup(temp);
    const { code, stdout, stderr } = await runCli(
      ["run", "--group-id", "A", "--file", csvPath, "--dry-run", "--workdir", workdir],
      temp,
    );
    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);
    assert.equal(output.dry_run, true);
    assert.equal(output.imported, 2);
    assert.equal(output.failed, 0);
    assert.equal(output.shopify_status, "draft");
    assert.equal(output.channels_published, false);
    assert.equal(output.fixture_used, "fixtures/product-create.success.json");

    const previewText = await readFile(path.join(groupDir, "products.import.preview.json"), "utf8");
    const resultText = await readFile(path.join(groupDir, "products.import.result.json"), "utf8");
    const preview = JSON.parse(previewText);
    const result = JSON.parse(resultText);
    assert.equal(preview.default_status, "draft");
    assert.deepEqual(preview.ignored_columns, ["source_url"]);
    assert.equal(result.fake, true);
    assert.equal(result.imported, 2);
    assert.equal(result.channels_published, false);
    for (const text of [stdout, stderr, previewText, resultText]) {
      assert.equal(text.includes(fixtureAccessUrl), false);
      assert.doesNotMatch(text, /"access[_-]?url"\s*:/i);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("import refuses a missing Preview Store connection", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "product-import-no-connection-"));
  try {
    const { workdir, csvPath } = await setupGroup(temp, { includeConnection: false });
    const validate = await runCli(
      ["validate", "--group-id", "A", "--file", csvPath, "--workdir", workdir],
      temp,
    );
    assert.equal(validate.code, 0, validate.stderr);

    const imported = await runCli(
      ["import", "--group-id", "A", "--dry-run", "--workdir", workdir],
      temp,
    );
    assert.notEqual(imported.code, 0);
    const error = JSON.parse(imported.stderr);
    assert.match(error.error, /connection not found/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("import refuses non-preview stores and real imports without --confirm", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "product-import-safety-"));
  try {
    const { workdir, csvPath } = await setupGroup(temp, { storeType: "development" });
    const validation = await runCli(
      ["validate", "--group-id", "A", "--file", csvPath, "--workdir", workdir],
      temp,
    );
    assert.equal(validation.code, 0, validation.stderr);
    const nonPreview = await runCli(
      ["import", "--group-id", "A", "--dry-run", "--workdir", workdir],
      temp,
    );
    assert.notEqual(nonPreview.code, 0);
    assert.match(JSON.parse(nonPreview.stderr).error, /only Preview Stores are allowed/i);

    const previewSetup = await setupGroup(temp);
    const noConfirm = await runCli(
      ["import", "--group-id", "A", "--dry-run", "--workdir", previewSetup.workdir],
      temp,
    );
    // --dry-run is explicitly allowed without --confirm and never calls Shopify.
    assert.equal(noConfirm.code, 0, noConfirm.stderr);

    // A real import must require explicit confirmation before any network call.
    const realImport = await runCli(
      ["import", "--group-id", "A", "--workdir", previewSetup.workdir],
      temp,
    );
    assert.notEqual(realImport.code, 0);
    assert.match(JSON.parse(realImport.stderr).error, /without --confirm/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
