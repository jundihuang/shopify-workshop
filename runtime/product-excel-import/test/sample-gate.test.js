import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../src/cli.js");
const repoRoot = path.resolve(__dirname, "../../..");
const bundledSample = path.join(repoRoot, "templates", "products.inflationwear-tshirt.sample.csv");

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

test("validate refuses the bundled sample sheet without --allow-sample", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "import-gate-"));
  try {
    const run = await runCli(
      ["validate", "--group-id", "A", "--workdir", path.join(temp, "ws"), "--file", bundledSample],
      temp,
    );
    assert.notEqual(run.code, 0);
    const err = JSON.parse(run.stderr);
    assert.match(err.error, /--allow-sample/);
    assert.match(err.error, /Ask the user where their product data comes from/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("validate accepts the bundled sample with --allow-sample and records it", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "import-gate-ok-"));
  try {
    const workdir = path.join(temp, "ws");
    const run = await runCli(
      ["validate", "--group-id", "A", "--workdir", workdir, "--file", bundledSample, "--allow-sample"],
      temp,
    );
    assert.equal(run.code, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.preview.sample_source_used, true);
    const preview = JSON.parse(await readFile(path.join(workdir, "A", "products.import.preview.json"), "utf8"));
    assert.equal(preview.sample_source_used, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("a merchant-provided sheet is not gated", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "import-gate-merchant-"));
  try {
    const workdir = path.join(temp, "ws");
    const merchantCsv = path.join(temp, "merchant-products.csv");
    await writeFile(
      merchantCsv,
      "handle,title,description,product_type,vendor,price,sku,image_url\n" +
        "my-tee,My Summer Tee,A soft cotton tee,Tee,My Brand,25.00,MT-1,https://example.com/tee.jpg\n",
      "utf8",
    );
    const run = await runCli(
      ["validate", "--group-id", "A", "--workdir", workdir, "--file", merchantCsv],
      temp,
    );
    assert.equal(run.code, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.preview.sample_source_used, false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
