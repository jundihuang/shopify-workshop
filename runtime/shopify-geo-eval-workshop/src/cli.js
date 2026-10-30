#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGeoConnection } from "./connection.js";
import { loadFixtureProducts } from "./fixture.js";
import {
  ensureWorkshopGitignore,
  pathExists,
  readJsonFile,
  readTextOrEmpty,
  relativeArtifactPath,
  writePrivateJson,
  writePrivateText,
} from "./files.js";
import { collectHtmlEvidence, previewThemeIdFrom } from "./html.js";
import {
  PLAN_FILENAME,
  SAMPLE_LIMIT,
  SCORE_FILENAME,
  SCORE_MARKDOWN_FILENAME,
  defaultFixturesDir,
} from "./paths.js";
import { assertArtifactSafe, assertNoRawAccessUrl, redactSensitiveText } from "./redact.js";
import { buildScorecard, renderScoreMarkdown, safePreviewUrl } from "./scorecard.js";
import { DIMENSION_KEYS, WEIGHTS, prepareSample } from "./score.js";
import { loadGeoScoreSchema, validateGeoScore } from "./schema.js";
import { fetchAdminProducts, readStoreInfoAccessUrl } from "./shopify.js";
import { updateGeoBeforeState } from "./state.js";

const CONFIRM_COPY = "「只读 Workshop GEO 打分（不改商品、不改主题、不读取店面密码）」";
const PASSWORD_FLAGS = new Set(["password", "storefront-password", "opening-soon-password"]);
const BOOLEAN_FLAGS = new Set(["help", "version", "json", "dry-run", "confirm", "skip-html"]);
const VALUE_FLAGS = new Set(["group-id", "group-dir", "workdir", "fixtures-dir"]);

function usage() {
  return `ShopWright Workshop — shopify-geo-eval-workshop runtime

Usage:
  node src/cli.js plan  (--group-id <id> | --group-dir <dir>)
  node src/cli.js apply (--group-id <id> | --group-dir <dir>) --confirm [--dry-run] [--skip-html]

Options:
  --group-id <id>        Workshop group id; artifacts live under .workshop/<id>/
  --group-dir <dir>      Explicit group directory override
  --workdir <dir>        Parent workshop workspace (default: .workshop)
  --confirm              Required for apply, including --dry-run.
                         Human confirmation happens outside this CLI after reviewing the plan.
  --dry-run              Score fixtures. Do not call Shopify and do not fetch accessUrl HTML.
  --skip-html            Score Admin fields only. Do not resolve a storefront session.
  --fixtures-dir <dir>   Directory containing admin-products.success.json for --dry-run
  --json                 Accepted for agent compatibility; output is JSON by default
  --help                 Show this help

Artifacts:
  .workshop/<group-id>/geo.plan.json
  .workshop/<group-id>/geo.before.json
  .workshop/<group-id>/geo.before.md
  .workshop/<group-id>/workshop-state.yaml   # geo.before_score, evidence_mode, restrictions

Safety:
  - Preview Store only. Read-only Admin product fields. Sample at most ${SAMPLE_LIMIT} products.
  - This is a workshop scorecard, not the full diagnostic.
  - Never mutates products or themes.
  - Never persists accessUrl, admin tokens, or a storefront password.
  - Storefront HTML is optional and uses an ephemeral shopify store info session.
  - If HTML is skipped or unavailable, evidence_mode is admin_only.
`;
}

function parseArgs(argv) {
  if (argv.length === 0) return { command: "help", opts: {} };
  const command = argv[0];
  const opts = {};
  const positional = [];

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equalsAt = token.indexOf("=");
    const key = token.slice(2, equalsAt === -1 ? undefined : equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : token.slice(equalsAt + 1);
    if (PASSWORD_FLAGS.has(key)) {
      throw new Error(
        "Refusing a storefront password flow. Workshop GEO does not accept an Opening soon password.",
      );
    }
    if (BOOLEAN_FLAGS.has(key)) {
      if (inlineValue !== undefined) throw new Error(`--${key} does not take a value`);
      opts[key] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(key)) throw new Error(`Unknown option --${key}`);
    let value = inlineValue;
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    opts[key] = value;
  }
  if (positional.length > 0) throw new Error(`Unexpected argument(s): ${positional.join(" ")}`);
  return { command, opts };
}

function requireString(value, flag) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${flag} is required`);
  return value.trim();
}

function validateGroupId(groupId) {
  const value = requireString(groupId, "--group-id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error("--group-id may contain only letters, numbers, dot, underscore, and dash");
  }
  return value;
}

function resolveGroupDir(opts) {
  if (opts["group-dir"]) return path.resolve(opts["group-dir"]);
  if (!opts["group-id"]) throw new Error("--group-id or --group-dir is required");
  return path.resolve(opts.workdir || ".workshop", validateGroupId(opts["group-id"]));
}

function groupIdFrom(opts, groupDir) {
  if (opts["group-id"]) return validateGroupId(opts["group-id"]);
  return path.basename(groupDir);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function continuationCommands(groupId) {
  const id = shellQuote(groupId);
  return [
    {
      id: "score_before",
      label: "确认并写出 Workshop GEO before 分",
      command: `./scripts/shopify-geo-eval-workshop.sh apply --group-id ${id} --confirm`,
    },
    {
      id: "dry_run",
      label: "离线演练（fixture 商品，不抓 HTML）",
      command: `./scripts/shopify-geo-eval-workshop.sh apply --group-id ${id} --confirm --dry-run`,
    },
  ];
}

async function readPreviewUrl(groupDir, facts) {
  if (facts.previewUrl) return facts.previewUrl;
  const manifestPath = path.join(groupDir, "theme.manifest.json");
  if (!(await pathExists(manifestPath))) return null;
  try {
    const manifest = await readJsonFile(manifestPath);
    return typeof manifest.preview_url === "string" ? manifest.preview_url : null;
  } catch {
    return null;
  }
}

function htmlDecision(connection, { dryRun, skipHtml }) {
  const channelReady = connection.facts.channelStatus === "online_store_active";
  const sessionReady = connection.storefront_session === "access_url";
  const htmlSkipped = Boolean(dryRun || skipHtml || !sessionReady || !channelReady);
  return { channelReady, sessionReady, htmlSkipped };
}

async function runPlan(opts) {
  const groupDir = resolveGroupDir(opts);
  const connection = await readGeoConnection(groupDir);
  const groupId = groupIdFrom(opts, groupDir);
  const decision = htmlDecision(connection, { dryRun: Boolean(opts["dry-run"]), skipHtml: Boolean(opts["skip-html"]) });
  const preview = safePreviewUrl(connection.store, await readPreviewUrl(groupDir, connection.facts));
  const plan = {
    ok: true,
    artifact: PLAN_FILENAME,
    schema_version: "1.0",
    command: "plan",
    group_id: groupId,
    store: connection.store,
    store_type: "preview",
    dry_run: Boolean(opts["dry-run"]),
    shopify_called: false,
    html_fetched: false,
    products_touched: false,
    theme_touched: false,
    mutations: false,
    sample_limit: SAMPLE_LIMIT,
    dimensions: DIMENSION_KEYS.map((key) => ({
      id: key,
      weight: WEIGHTS[key],
    })),
    evidence_plan: {
      admin: "read_only_product_fields",
      html: decision.htmlSkipped ? "skipped" : "ephemeral_store_info_session",
      technical: "capped_unauthenticated_storefront",
    },
    channel_status: connection.facts.channelStatus,
    channel_ready: decision.channelReady,
    storefront_session: connection.storefront_session,
    participant_confirm_copy: CONFIRM_COPY,
    continuations: continuationCommands(groupId),
    note: "This is a workshop scorecard, not the full diagnostic.",
  };
  if (preview) plan.preview_url = preview;

  await ensureWorkshopGitignore(groupDir);
  const artifactPath = path.join(groupDir, PLAN_FILENAME);
  const serialized = `${JSON.stringify(plan, null, 2)}\n`;
  assertNoRawAccessUrl(serialized, connection.accessUrlForGuard);
  await writePrivateJson(artifactPath, plan);
  return {
    ...plan,
    artifacts: {
      plan_json: relativeArtifactPath(artifactPath),
    },
    next: "Review the plan with a human, then run apply --confirm. Use apply --confirm --dry-run to score fixtures without Shopify.",
  };
}

async function loadProducts(opts, connection) {
  if (opts["dry-run"]) {
    const products = await loadFixtureProducts(path.resolve(opts["fixtures-dir"] || defaultFixturesDir()));
    return { products, shopify_called: false };
  }
  const products = await fetchAdminProducts({ domain: connection.store });
  return { products, shopify_called: true };
}

async function maybeCollectHtml(opts, connection, products, decision, previewUrl) {
  if (decision.htmlSkipped || opts["dry-run"]) {
    return { byHandle: {}, restrictions: [], shopify_called: false };
  }
  const sample = prepareSample(products);
  const html = await collectHtmlEvidence({
    handles: sample.products.map((product) => product.handle),
    previewThemeId: previewUrl ? previewThemeIdFrom(previewUrl) : null,
    loadAccessUrl: () => readStoreInfoAccessUrl({ domain: connection.store }),
  });
  return { ...html, shopify_called: true };
}

async function runApply(opts) {
  if (!opts.confirm) {
    throw new Error(
      "Refusing to apply without --confirm. Review geo.plan.json and obtain human confirmation outside the CLI.",
    );
  }

  const groupDir = resolveGroupDir(opts);
  const connection = await readGeoConnection(groupDir);
  const dryRun = Boolean(opts["dry-run"]);
  const decision = htmlDecision(connection, { dryRun, skipHtml: Boolean(opts["skip-html"]) });
  const rawPreview = await readPreviewUrl(groupDir, connection.facts);
  const previewUrl = safePreviewUrl(connection.store, rawPreview);
  const loaded = await loadProducts(opts, connection);
  const html = await maybeCollectHtml(opts, connection, loaded.products, decision, previewUrl);
  const scorecard = buildScorecard({
    store: connection.store,
    previewUrl,
    products: loaded.products,
    htmlByHandle: html.byHandle,
    restrictions: html.restrictions,
    htmlSkipped: decision.htmlSkipped,
    channelReady: decision.channelReady,
  });
  const schema = await loadGeoScoreSchema();
  const schemaErrors = validateGeoScore(scorecard, schema);
  if (schemaErrors.length > 0) {
    throw new Error(`Scorecard does not match the workshop GEO schema: ${schemaErrors.map((entry) => entry.message).join("; ")}`);
  }

  const statePath = path.join(groupDir, "workshop-state.yaml");
  const existingState = connection.stateText || await readTextOrEmpty(statePath);
  const nextState = updateGeoBeforeState(existingState, {
    beforeScore: scorecard.geo_score,
    evidenceMode: scorecard.evidence_mode,
    restrictions: scorecard.restrictions,
  });
  const markdown = `${renderScoreMarkdown(scorecard).replace(/\n+$/, "")}\n`;
  const scorePath = path.join(groupDir, SCORE_FILENAME);
  const markdownPath = path.join(groupDir, SCORE_MARKDOWN_FILENAME);
  const output = {
    ok: true,
    command: "apply",
    dry_run: dryRun,
    store: connection.store,
    store_type: "preview",
    geo_score: scorecard.geo_score,
    grade: scorecard.grade,
    evidence_mode: scorecard.evidence_mode,
    restrictions: scorecard.restrictions,
    dimensions: scorecard.dimensions,
    sample_size: scorecard.products.length,
    shopify_called: loaded.shopify_called || html.shopify_called,
    html_fetched: scorecard.evidence_mode === "hybrid_admin_preview",
    products_touched: false,
    theme_touched: false,
    mutations: false,
    state_updated: true,
    skill: scorecard.skill,
    artifacts: {
      geo_before_json: relativeArtifactPath(scorePath),
      geo_before_md: relativeArtifactPath(markdownPath),
      workshop_state_yaml: relativeArtifactPath(statePath),
    },
  };
  if (dryRun) output.fixture_used = "fixtures/admin-products.success.json";
  if (previewUrl) output.preview_url = previewUrl;

  const guarded = [
    `${JSON.stringify(scorecard, null, 2)}\n`,
    markdown,
    nextState,
    `${JSON.stringify(output, null, 2)}\n`,
  ];
  for (const text of guarded) assertNoRawAccessUrl(text, connection.accessUrlForGuard);

  await ensureWorkshopGitignore(groupDir);
  await writePrivateJson(scorePath, scorecard);
  await writePrivateText(markdownPath, markdown);
  await writePrivateText(statePath, nextState);
  return output;
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.version) {
    process.stdout.write(`${JSON.stringify({ runtime: "shopify-geo-eval-workshop", version: "0.1.0" })}\n`);
    return;
  }
  if (command === "help" || command === "--help" || opts.help) {
    process.stdout.write(usage());
    return;
  }

  let output;
  switch (command) {
    case "plan":
      output = await runPlan(opts);
      break;
    case "apply":
      output = await runApply(opts);
      break;
    default:
      throw new Error(`Unknown command "${command}". Run with --help for usage.`);
  }

  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  assertArtifactSafe(serialized);
  process.stdout.write(serialized);
  if (output.ok === false) process.exitCode = 2;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          error: redactSensitiveText(error.message),
          hints: [
            "Run plan --group-id <id> and review it with a human.",
            "Use apply --confirm to score a Preview Store, or apply --confirm --dry-run for fixtures.",
            "This runtime never mutates products or themes and never accepts a storefront password.",
          ],
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  });
}

export { CONFIRM_COPY };
