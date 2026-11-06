import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../src/cli.js");
const repoRoot = path.resolve(__dirname, "../../..");
const bundledSampleAnswers = path.join(repoRoot, "templates", "brand-intake.answers.sample.json");

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

test("plan refuses the bundled sample answers without --allow-sample", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "brand-gate-"));
  try {
    const workdir = path.join(temp, ".workshop");
    const groupDir = path.join(workdir, "A");
    await mkdir(groupDir, { recursive: true });
    const run = await runCli(
      ["plan", "--group-id", "A", "--workdir", workdir, "--answers", bundledSampleAnswers],
      temp,
    );
    assert.notEqual(run.code, 0);
    const err = JSON.parse(run.stderr);
    assert.match(err.error, /--allow-sample/);
    assert.match(err.error, /Ask the user for their brand details/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("plan accepts the sample answers with --allow-sample", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "brand-gate-ok-"));
  try {
    const workdir = path.join(temp, ".workshop");
    const groupDir = path.join(workdir, "A");
    await mkdir(groupDir, { recursive: true });
    await writeFile(path.join(groupDir, "connection.json"), "{}\n");
    const run = await runCli(
      ["plan", "--group-id", "A", "--workdir", workdir, "--answers", bundledSampleAnswers, "--allow-sample"],
      temp,
    );
    assert.equal(run.code, 0, run.stderr);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
