import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defaultDemoPath } from "../src/paths.js";

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

async function setupGroup(temp) {
  const workdir = path.join(temp, ".workshop");
  const groupDir = path.join(workdir, "A");
  await mkdir(groupDir, { recursive: true });
  await mkdir(path.join(temp, ".git"), { recursive: true });
  await writeFile(
    path.join(groupDir, "workshop-state.yaml"),
    `group_id: "A"
store_domain: "aurora-workshop-mvp.myshopify.com"
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
  brief_file: null
  status: pending

theme:
  theme_id: 123
  status: unpublished
  preview_url: "https://aurora-workshop.myshopify.com/?preview_theme_id=123"
  fallback_used: false
`,
    "utf8",
  );
  return { workdir, groupDir };
}

test("plan lists missing fields and risk flags without writing the brief", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "brand-intake-plan-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const answersPath = path.join(temp, "answers.json");
    await writeFile(
      answersPath,
      `${JSON.stringify({
        brand_name: "Glow Lab",
        tagline: "A miracle overnight cream",
        positioning: "Clinically proven to cure acne",
        audience: "Adults comparing routines",
        primary_color: "#ABCDEF",
      })}\n`,
      "utf8",
    );

    const planRun = await runCli(
      ["plan", "--group-id", "A", "--workdir", workdir, "--answers", answersPath],
      temp,
    );
    assert.equal(planRun.code, 0, planRun.stderr);
    const plan = JSON.parse(planRun.stdout);
    assert.equal(plan.ok, true);
    assert.equal(plan.writes_brief, false);
    assert.equal(plan.shopify_called, false);
    assert.equal(plan.theme_touched, false);
    assert.equal(plan.products_touched, false);
    assert.ok(plan.missing.includes("tone.voice"));
    assert.ok(plan.missing.includes("selling_points"));
    assert.equal(plan.missing.includes("locale"), false);
    assert.equal(plan.normalized_brief.locale, "en-US");
    assert.equal(plan.normalized_brief.currency, "USD");
    assert.ok(plan.risk_flags.some((flag) => flag.kind === "medical" && flag.phrase.toLowerCase() === "cure"));
    assert.match(plan.tone_avoid.join("\n"), /medical claim: "cure"/);
    assert.equal(plan.participant_confirm_copy.includes("锁定 Brand Brief"), true);
    assert.ok(plan.continuations.some((item) => item.id === "continue_with_defaults" && item.label === "用默认值继续"));
    assert.ok(plan.continuations.some((item) => item.id === "load_demo_brief" && item.label.includes("Aurora Skincare")));

    const planText = await readFile(path.join(groupDir, "brand-brief.plan.json"), "utf8");
    assert.equal(JSON.parse(planText).schema_valid, true);
    await assert.rejects(readFile(path.join(groupDir, "brand-brief.json"), "utf8"), /ENOENT/);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /status: pending/);
    assert.equal(planText.includes(fixtureAccessUrl), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply refuses without --confirm, including dry-run, and writes nothing", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "brand-intake-confirm-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const refused = await runCli(["apply", "--group-id", "A", "--workdir", workdir, "--demo"], temp);
    assert.notEqual(refused.code, 0);
    assert.match(JSON.parse(refused.stderr).error, /without --confirm/i);

    const refusedDryRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--demo", "--dry-run"],
      temp,
    );
    assert.notEqual(refusedDryRun.code, 0);
    assert.match(JSON.parse(refusedDryRun.stderr).error, /without --confirm/i);
    await assert.rejects(readFile(path.join(groupDir, "brand-brief.json"), "utf8"), /ENOENT/);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /status: pending/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("dry-run apply --demo writes the Aurora fixture without an answers file", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "brand-intake-demo-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const demo = JSON.parse(await readFile(defaultDemoPath(), "utf8"));
    const applyRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--demo", "--dry-run", "--confirm"],
      temp,
    );
    assert.equal(applyRun.code, 0, applyRun.stderr);
    const output = JSON.parse(applyRun.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.dry_run, true);
    assert.equal(output.demo, true);
    assert.equal(output.status, "fallback_demo");
    assert.equal(output.brand_name, "Aurora Skincare");
    assert.deepEqual(output.missing, []);
    assert.deepEqual(output.risk_flags, []);
    assert.equal(output.shopify_called, false);
    assert.equal(output.theme_touched, false);
    assert.equal(output.products_touched, false);
    assert.equal(output.state_updated, true);
    assert.equal(output.fixture_used, "templates/brand-brief.demo.aurora-skincare.json");

    const brief = JSON.parse(await readFile(path.join(groupDir, "brand-brief.json"), "utf8"));
    assert.deepEqual(brief, demo);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /brief_file: brand-brief\.json/);
    assert.match(state, /status: fallback_demo/);
    assert.match(state, /channel_status: draft/);
    assert.match(state, /theme:\n {2}theme_id: 123\n {2}status: unpublished/);
    assert.equal(state.includes(fixtureAccessUrl), false);
    assert.doesNotMatch(state, /access[_-]?url\s*:\s*https?:\/\//i);
    assert.equal(JSON.stringify(brief).includes(fixtureAccessUrl), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("apply --confirm locks student answers as brand.status done", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "brand-intake-apply-"));
  try {
    const { workdir, groupDir } = await setupGroup(temp);
    const answersPath = path.join(temp, "answers.json");
    await writeFile(
      answersPath,
      `${JSON.stringify({
        brand_name: "Harbor Supply",
        tagline: "Tools for a smaller kitchen.",
        positioning: "A small kitchen-tool brand for people who cook often and buy rarely.",
        audience: "Home cooks who want fewer tools",
        tone: "calm and concrete",
        primary_color: "#1F3A5F",
        selling_points: ["Named materials"],
        locale: "en_us",
        currency: "usd",
      })}\n`,
      "utf8",
    );

    const applyRun = await runCli(
      ["apply", "--group-id", "A", "--workdir", workdir, "--answers", answersPath, "--confirm"],
      temp,
    );
    assert.equal(applyRun.code, 0, applyRun.stderr);
    const output = JSON.parse(applyRun.stdout);
    assert.equal(output.status, "done");
    assert.equal(output.demo, false);
    assert.equal(output.dry_run, false);
    assert.equal(output.shopify_called, false);
    assert.equal(output.fixture_used, undefined);

    const brief = JSON.parse(await readFile(path.join(groupDir, "brand-brief.json"), "utf8"));
    assert.equal(brief.brand_name, "Harbor Supply");
    assert.equal(brief.locale, "en-US");
    assert.equal(brief.currency, "USD");
    assert.deepEqual(brief.missing, []);
    const state = await readFile(path.join(groupDir, "workshop-state.yaml"), "utf8");
    assert.match(state, /brand:\n {2}brief_file: brand-brief\.json\n {2}status: done/);
    assert.match(state, /store_type: preview/);
    assert.match(state, /channel_status: draft/);
    assert.doesNotMatch(state, /fallback_demo/);
    assert.doesNotMatch(state, /status: pending/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
