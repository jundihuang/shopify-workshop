import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../src/cli.js");
const fixtureAccessUrl = "https://preview.example.invalid/access/session-fixture-DO-NOT-PERSIST";

async function runCli(args, options = {}) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024,
  });
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else files.push(full);
  }
  return files;
}

test("dry-run connect writes safe artifacts and info returns the URL only on stdout", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "store-connect-cli-"));
  try {
    await mkdir(path.join(temp, ".git"));
    const workdir = path.join(temp, ".workshop");
    const common = ["--group-id", "A", "--dry-run", "--workdir", workdir];

    const connect = await runCli(
      ["connect", "--group-id", "A", "--name", "Group A Aurora", "--mode", "hands_on", "--dry-run", "--workdir", workdir],
      { cwd: temp },
    );
    assert.equal(connect.stderr, "");
    assert.equal(connect.stdout.includes(fixtureAccessUrl), false);

    const connectResult = JSON.parse(connect.stdout);
    assert.equal(connectResult.ok, true);
    assert.equal(connectResult.connection.store, "aurora-workshop-mvp.myshopify.com");
    assert.equal(connectResult.connection.store_type, "preview");
    assert.equal(connectResult.connection.storefront_session, "access_url");
    assert.equal(connectResult.connection.auth, "cli_cached_admin_token");
    assert.equal(connectResult.connection.scopes_ok, true);
    assert.equal("password" in connectResult.connection, false);
    assert.equal("access_url" in connectResult.connection, false);

    const connection = JSON.parse(await readFile(path.join(workdir, "A", "connection.json"), "utf8"));
    assert.deepEqual(connection.scopes_include, ["write_products", "write_themes", "write_publications"]);
    assert.equal(connection.storefront_session, "access_url");

    const state = await readFile(path.join(workdir, "A", "workshop-state.yaml"), "utf8");
    assert.match(state, /status: connected/);
    assert.match(state, /storefront_session: access_url/);
    assert.doesNotMatch(state, /access[_-]?url\s*:\s*https?:\/\//i);

    const gitignore = await readFile(path.join(temp, ".gitignore"), "utf8");
    assert.match(gitignore, /^\.workshop\/$/m);

    for (const file of await listFiles(temp)) {
      if (file.includes(`${path.sep}.git${path.sep}`)) continue;
      const contents = await readFile(file, "utf8");
      assert.equal(contents.includes(fixtureAccessUrl), false, `accessUrl leaked into ${file}`);
    }

    const info = await runCli(["info", ...common], { cwd: temp });
    const infoResult = JSON.parse(info.stdout);
    assert.equal(infoResult.access_url, fixtureAccessUrl);
    assert.equal(info.stdout.includes(fixtureAccessUrl), true);
    assert.equal(info.stderr, "");

    const verify = await runCli(["verify", ...common], { cwd: temp });
    assert.equal(verify.stdout.includes(fixtureAccessUrl), false);
    const verifyResult = JSON.parse(verify.stdout);
    assert.equal(verifyResult.scopes_ok, true);
    assert.equal(verifyResult.access_url_available, true);

    const open = await runCli(["open", ...common], { cwd: temp });
    assert.equal(open.stdout.includes(fixtureAccessUrl), false);
    const openResult = JSON.parse(open.stdout);
    assert.equal(openResult.opened, false);
    assert.match(openResult.command, /shopify store open --store/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("create records the domain without requiring info or persisting a URL", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "store-connect-create-"));
  try {
    const workdir = path.join(temp, ".workshop");
    const result = await runCli(
      ["create", "--group-id", "B", "--name", "Group B Borealis", "--dry-run", "--workdir", workdir],
      { cwd: temp },
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.connection.store, "aurora-workshop-mvp.myshopify.com");

    const connectionText = await readFile(path.join(workdir, "B", "connection.json"), "utf8");
    assert.equal(connectionText.includes(fixtureAccessUrl), false);
    assert.match(connectionText, /"store": "aurora-workshop-mvp\.myshopify\.com"/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
