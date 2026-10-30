import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadGeoScoreSchema, validateGeoScore } from "../../shopify-geo-eval-workshop/src/schema.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../src/cli.js");
const repoRoot = path.resolve(__dirname, "../../..");
const fixturesDir = path.resolve(__dirname, "../fixtures");
const shellPath = path.join(repoRoot, "scripts/shopify-geo-optimizer.sh");
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
if (/password|onlineStorePassword|publishablePublish|\\btheme\\b/i.test(joined)) {
  process.stderr.write("forbidden\\n");
  process.exit(3);
}
if (args[0] === "store" && args[1] === "execute") {
  const query = args[args.indexOf("--query") + 1] || "";
  if (/password|onlineStorePassword|publishablePublish|themePublish/i.test(query)) {
    process.stderr.write("forbidden query\\n");
    process.exit(4);
  }
  if (/productUpdate/.test(query)) {
    if (!args.includes("--allow-mutations")) {
      process.stderr.write("mutation without flag\\n");
      process.exit(5);
    }
    const variables = JSON.parse(args[args.indexOf("--variables") + 1] || "{}");
    process.stdout.write(JSON.stringify({
      data: { productUpdate: { product: { id: variables.product.id, handle: "updated" }, userErrors: [] } }
    }) + "\\n");
    process.exit(0);
  }
  const variables = JSON.parse(args[args.indexOf("--variables") + 1] || "{}");
  const handle = String(variables.query || "").replace(/^handle:/, "");
  process.stdout.write(JSON.stringify({
    data: { products: { nodes: [{ id: "gid://shopify/Product/" + handle, handle }] } }
  }) + "\\n");
  process.exit(0);
}
process.stderr.write("unexpected\\n");
process.exit(2);
`;
}

function fakeEvalSource() {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.EVAL_ARGV_LOG, JSON.stringify(args) + "\\n");
if (!args.includes("--confirm") || args[args.indexOf("--phase") + 1] !== "after") {
  process.stderr.write("expected workshop phase after\\n");
  process.exit(2);
}
const groupDir = args[args.indexOf("--group-dir") + 1];
const after = {
  store: ${JSON.stringify(store)},
  geo_score: 81,
  grade: "A",
  evidence_mode: "admin_only",
  restrictions: ["html_evidence_skipped", "unauthenticated_storefront_restricted"],
  dimensions: {
    product_data_completeness: 85,
    search_findability: 84,
    ai_understandability: 80,
    purchase_trust: 75,
    technical_visibility: 40
  },
  top_issues: [],
  products: [
    { handle: "daily-serum", score: 80, priority: "P2" },
    { handle: "night-cream", score: 82, priority: "P2" }
  ],
  skill: "shopify-geo-eval-workshop"
};
fs.writeFileSync(groupDir + "/geo.after.json", JSON.stringify(after, null, 2) + "\\n");
fs.writeFileSync(groupDir + "/geo.after.md", "# after\\n");
`;
}

async function installFake(temp, name, source) {
  const bin = path.join(temp, name);
  await writeFile(bin, source, "utf8");
  await chmod(bin, 0o755);
  return bin;
}

async function setupGroup(temp, { storeType = "preview" } = {}) {
  const workdir = path.join(temp, ".workshop");
  const groupDir = path.join(workdir, "A");
  await mkdir(groupDir, { recursive: true });
  await mkdir(path.join(temp, ".git"), { recursive: true });
  const connection = {
    store,
    store_name: "Group A Aurora",
    store_type: storeType,
    auth: "cli_cached_admin_token",
    scopes_ok: true,
    scopes_include: ["write_products", "write_themes", "write_publications"],
    storefront_session: "access_url",
    accessUrl: fixtureAccessUrl,
  };
  await writeFile(path.join(groupDir, "connection.json"), `${JSON.stringify(connection, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(groupDir, "workshop-state.yaml"),
    `group_id: "A"
store_domain: "${store}"
mode: "hands_on"

connection:
  status: connected
  store_type: preview
  scopes_ok: true
  auth: cli_cached_admin_token
  storefront_session: access_url

products:
  channel_status: online_store_active

brand:
  brief_file: brand-brief.json
  status: done

geo:
  evidence_mode: admin_only
  before_score: 35
  after_score: null
  optimizer_status: pending
  restrictions:
    - html_evidence_skipped
`,
    "utf8",
  );
  await writeFile(
    path.join(groupDir, "geo.before.json"),
    await readFile(path.join(fixturesDir, "geo.before.json"), "utf8"),
  );
  await writeFile(
    path.join(groupDir, "brand-brief.json"),
    await readFile(path.join(fixturesDir, "brand-brief.json"), "utf8"),
  );
  return { workdir, groupDir };
}

function assertNoSecrets(text) {
  assert.equal(text.includes(fixtureAccessUrl), false);
  assert.doesNotMatch(text, /access[_-]?url\s*[:=]\s*https?:\/\//i);
  assert.doesNotMatch(text, /onlineStorePasswordProtectionUpdate/);
  assert.doesNotMatch(text, /"password"\s*:/);
}

test("plan builds a proposal and does not call Shopify", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "opt-plan-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const shopify = await installFake(temp, "shopify", fakeShopifySource());
    const shopifyLog = path.join(temp, "shopify.log");
    const planned = await runCli(["plan", "--group-id", "A", "--workdir", workdir], temp, {
      SHOPIFY_CLI_BIN: shopify,
      SHOPIFY_ARGV_LOG: shopifyLog,
    });
    assert.equal(planned.code, 0, planned.stderr);
    const output = JSON.parse(planned.stdout);
    assert.equal(output.command, "plan");
    assert.equal(output.shopify_called, false);
    assert.equal(output.eval_called, false);
    assert.equal(output.mutations, false);
    assert.equal(output.ux.line_by_line_review, false);
    assert.match(output.participant_confirm_copy, /批准全部 P0/);
    await assert.rejects(readFile(shopifyLog, "utf8"));
    await assert.rejects(readFile(path.join(groupDir, "geo.approved.json"), "utf8"));
    const proposal = JSON.parse(await readFile(path.join(groupDir, "geo.proposal.json"), "utf8"));
    assert.ok(proposal.counts.p0 >= 3);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /optimizer_status: pending/);
    assert.match(state, /before_score: 35/);
    assertNoSecrets(`${planned.stdout}\n${JSON.stringify(proposal)}\n${state}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply refuses to run without --confirm", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "opt-confirm-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const refused = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--approve-all-p0", "--dry-run"],
      temp,
    );
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /Refusing to apply without --confirm/);
    await assert.rejects(readFile(path.join(groupDir, "geo.approved.json"), "utf8"));
    await assert.rejects(readFile(path.join(groupDir, "geo.after.json"), "utf8"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply refuses to write without an approved set", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "opt-approved-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const refused = await runCli(["apply", "--group-id", "A", "--workdir", workdir, "--confirm", "--dry-run"], temp);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /Refusing to write without an approved set/);
    await assert.rejects(readFile(path.join(groupDir, "geo.after.json"), "utf8"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply refuses a non-preview store", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "opt-preview-"));
  try {
    const { workdir } = await setupGroup(temp, { storeType: "development" });
    const refused = await runCli(["plan", "--group-id", "A", "--workdir", workdir], temp);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /non-preview/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("dry-run approve-all-p0 writes fixtures and does not call Shopify", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "opt-dry-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const evalProducts = JSON.parse(
      await readFile(path.join(repoRoot, "runtime/shopify-geo-eval-workshop/fixtures/admin-products.success.json"), "utf8"),
    );
    const before = JSON.parse(await readFile(path.join(groupDir, "geo.before.json"), "utf8"));
    const thin = before.products[0];
    before.products = evalProducts.products.map((product) => ({
      ...thin,
      handle: product.handle,
    }));
    await writeFile(path.join(groupDir, "geo.before.json"), `${JSON.stringify(before, null, 2)}\n`);
    const shopify = await installFake(temp, "shopify", fakeShopifySource());
    const evalCli = await installFake(temp, "eval.js", fakeEvalSource());
    const shopifyLog = path.join(temp, "shopify.log");
    const evalLog = path.join(temp, "eval.log");
    const applied = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--confirm", "--approve-all-p0", "--dry-run"],
      temp,
      {
        SHOPIFY_CLI_BIN: shopify,
        SHOPIFY_ARGV_LOG: shopifyLog,
        SHOPIFY_GEO_EVAL_CLI: evalCli,
        EVAL_ARGV_LOG: evalLog,
      },
    );
    assert.equal(applied.code, 0, applied.stderr);
    const output = JSON.parse(applied.stdout);
    assert.equal(output.dry_run, true);
    assert.equal(output.shopify_called, false);
    assert.equal(output.eval_called, false);
    assert.equal(output.mutations, false);
    assert.equal(output.products_touched, false);
    assert.equal(output.theme_touched, false);
    assert.equal(output.after_score_source, "fixture");
    assert.equal(output.optimizer_status, "approved_p0_batch");
    assert.equal(output.line_by_line_review, false);
    assert.equal(output.p1_written, 0);
    await assert.rejects(readFile(shopifyLog, "utf8"));
    await assert.rejects(readFile(evalLog, "utf8"));

    const approved = JSON.parse(await readFile(path.join(groupDir, "geo.approved.json"), "utf8"));
    assert.equal(approved.mode, "approve_all_p0");
    assert.ok(approved.suggestions.length >= 3);
    assert.equal(approved.suggestions.every((item) => item.priority === "P0"), true);
    assert.equal(approved.suggestions.some((item) => item.field === "faq"), false);
    const after = JSON.parse(await readFile(path.join(groupDir, "geo.after.json"), "utf8"));
    const schema = await loadGeoScoreSchema();
    assert.deepEqual(validateGeoScore(after, schema), []);
    assert.equal(after.skill, "shopify-geo-eval-workshop");
    assert.equal(after.geo_score, 74);
    assert.equal(after.store, store);
    assert.equal(after.products.length, 8);
    assert.deepEqual(
      after.products.map((product) => product.handle),
      before.products.map((product) => product.handle),
    );
    assert.equal(
      after.products.some((product) => product.handle === "daily-serum" || product.handle === "night-cream"),
      false,
    );
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /after_score: 74/);
    assert.match(state, /optimizer_status: approved_p0_batch/);
    assert.match(state, /before_score: 35/);
    assertNoSecrets(`${applied.stdout}\n${JSON.stringify(approved)}\n${JSON.stringify(after)}\n${state}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("live apply updates products then calls the workshop eval", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "opt-live-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const shopify = await installFake(temp, "shopify", fakeShopifySource());
    const evalCli = await installFake(temp, "eval.js", fakeEvalSource());
    const shopifyLog = path.join(temp, "shopify.log");
    const evalLog = path.join(temp, "eval.log");
    const applied = await runCli(
      [
        "apply",
        "--group-id",
        "A",
        "--workdir",
        workdir,
        "--confirm",
        "--approve-all-p0",
        "--deep-review",
        "daily-serum",
      ],
      temp,
      {
        SHOPIFY_CLI_BIN: shopify,
        SHOPIFY_ARGV_LOG: shopifyLog,
        SHOPIFY_GEO_EVAL_CLI: evalCli,
        EVAL_ARGV_LOG: evalLog,
      },
    );
    assert.equal(applied.code, 0, applied.stderr);
    const output = JSON.parse(applied.stdout);
    assert.equal(output.dry_run, false);
    assert.equal(output.shopify_called, true);
    assert.equal(output.eval_called, true);
    assert.equal(output.eval_runtime, "shopify-geo-eval-workshop");
    assert.equal(output.after_score_source, "shopify-geo-eval-workshop");
    assert.equal(output.products_updated, 2);
    assert.equal(output.after_score, 81);
    assert.deepEqual(output.deep_review_handles, ["daily-serum"]);
    const shopifyArgs = await readFile(shopifyLog, "utf8");
    assert.match(shopifyArgs, /productUpdate/);
    assert.match(shopifyArgs, /--allow-mutations/);
    assert.doesNotMatch(shopifyArgs, /password|publishablePublish|theme/);
    const evalArgs = JSON.parse((await readFile(evalLog, "utf8")).trim().split("\n")[0]);
    assert.equal(evalArgs.includes("--phase") && evalArgs[evalArgs.indexOf("--phase") + 1] === "after", true);
    assert.equal(evalArgs.includes("--confirm"), true);
    assert.equal(evalArgs.includes("--skip-html"), true);
    assert.equal(evalArgs.some((arg) => String(arg).includes("run.py")), false);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /after_score: 81/);
    assert.match(state, /optimizer_status: approved_p0_batch/);
    assert.match(state, /before_score: 35/);
    const after = await readFile(path.join(groupDir, "geo.after.json"), "utf8");
    assertNoSecrets(`${applied.stdout}\n${shopifyArgs}\n${evalArgs.join(" ")}\n${state}\n${after}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("brand-brief tone.avoid and medical claims stay out of after text", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "opt-tone-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const brief = {
      brand_name: "Aurora Skincare",
      category: "serum",
      scene: "a short morning routine",
      selling_points: ["Ingredient names in plain language", "clinically proven miracle cure"],
      tone: { avoid: ["luxury hype", "miracle"] },
    };
    await writeFile(path.join(groupDir, "brand-brief.json"), `${JSON.stringify(brief, null, 2)}\n`);
    const planned = await runCli(["plan", "--group-id", "A", "--workdir", workdir], temp);
    assert.equal(planned.code, 0, planned.stderr);
    const proposal = JSON.parse(await readFile(path.join(groupDir, "geo.proposal.json"), "utf8"));
    assert.equal(proposal.suggestions.length > 0, true);
    for (const item of proposal.suggestions) {
      assert.doesNotMatch(item.after, /miracle|clinically\s+proven|\bcure\b|luxury hype|guaranteed/i, item.field);
    }
    assert.equal(
      proposal.suggestions.some((item) => /serum/i.test(item.after) && /morning routine/i.test(item.after)),
      true,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("shell wrapper reaches the runtime help", async () => {
  const result = await execFileAsync(shellPath, ["--help"], { encoding: "utf8" });
  assert.match(result.stdout, /approve-all-p0/);
  assert.match(result.stdout, /shopify-geo-eval-workshop/);
});
