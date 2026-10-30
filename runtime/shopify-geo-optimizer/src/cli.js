#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acceptApprovedFile, approveAllP0 } from "./approve.js";
import { loadFixtureAfterScore, renderFixtureAfterMarkdown } from "./after.js";
import { readOptimizerConnection } from "./connection.js";
import { readConstraints } from "./copy.js";
import {
  ensureWorkshopGitignore,
  pathExists,
  readJsonFile,
  readTextOrEmpty,
  relativeArtifactPath,
  writePrivateJson,
  writePrivateText,
} from "./files.js";
import {
  AFTER_FILENAME,
  AFTER_MARKDOWN_FILENAME,
  APPROVED_FILENAME,
  BEFORE_FILENAME,
  BRIEF_FILENAME,
  PROPOSAL_FILENAME,
} from "./paths.js";
import { assertWorkshopScorecard, buildProposal, extraFieldsFromPreview } from "./propose.js";
import { assertArtifactSafe, assertNoRawAccessUrl, assertNoSensitiveKeys, redactSensitiveText } from "./redact.js";
import { rescoreWithWorkshopEval } from "./rescore.js";
import { updateApprovedProducts } from "./shopify.js";
import { updateOptimizerState } from "./state.js";

const CONFIRM_COPY = "「批准全部 P0 并写回 Preview Store 商品字段（不发布主题）」";
const PASSWORD_FLAGS = new Set(["password", "storefront-password", "opening-soon-password"]);
const BOOLEAN_FLAGS = new Set(["help", "version", "json", "dry-run", "confirm", "approve-all-p0"]);
const VALUE_FLAGS = new Set(["group-id", "group-dir", "workdir"]);
const REPEATABLE_FLAGS = new Set(["deep-review", "ignore"]);

function usage() {
  return `ShopWright Workshop — shopify-geo-optimizer runtime

Usage:
  node src/cli.js plan  (--group-id <id> | --group-dir <dir>)
  node src/cli.js apply (--group-id <id> | --group-dir <dir>) --confirm --approve-all-p0 [--dry-run]
        [--deep-review <handle>] [--ignore <handle:field>]

Options:
  --group-id <id>        Workshop group id; artifacts live under .workshop/<id>/
  --group-dir <dir>      Explicit group directory override
  --workdir <dir>        Parent workshop workspace (default: .workshop)
  --confirm              Required for apply, including --dry-run.
                         Human confirmation happens outside this CLI.
  --approve-all-p0       Approve every P0 suggestion in one batch. P1 stays collapsed.
  --deep-review <handle> Optional. At most 2 product handles. Does not require a line-by-line review.
  --ignore <handle:field> Drop one suggestion on a deep-reviewed product.
  --dry-run              Do not call Shopify and do not rescore. Write the fixture after score.
  --json                 Accepted for agent compatibility; output is JSON by default
  --help                 Show this help

Commands:
  ./scripts/shopify-geo-optimizer.sh plan --group-id A
  ./scripts/shopify-geo-optimizer.sh apply --group-id A --confirm --approve-all-p0
  ./scripts/shopify-geo-optimizer.sh apply --group-id A --confirm --approve-all-p0 --dry-run

Inputs:
  .workshop/<group-id>/geo.before.json    # shopify-geo-eval-workshop scorecard
  .workshop/<group-id>/brand-brief.json

Artifacts:
  .workshop/<group-id>/geo.proposal.json  # plan, and apply when no proposal exists yet
  .workshop/<group-id>/geo.approved.json  # apply
  .workshop/<group-id>/geo.after.json     # apply
  .workshop/<group-id>/workshop-state.yaml  # geo.optimizer_status, geo.after_score

Safety:
  - Preview Store only. --confirm is required before any write.
  - P0 batch fields: title, description, meta_title, meta_description, key attributes.
  - Copy uses the workshop scorecard plus brand-brief category, selling points, and scene.
  - tone.avoid and medical or hype phrasing are removed from after text.
  - Default review is approve-all P0. Deep review is optional and limited to 1–2 products.
  - P1 suggestions stay collapsed and are not written by --approve-all-p0.
  - Live rescore calls shopify-geo-eval-workshop --phase after. It does not score locally.
  - --dry-run writes fixtures only and does not call Shopify.
  - Never persists accessUrl, admin tokens, or a storefront password.
  - Does not publish the theme.
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
        "Refusing a storefront password flow. The workshop optimizer does not accept an Opening soon password.",
      );
    }
    if (BOOLEAN_FLAGS.has(key)) {
      if (inlineValue !== undefined) throw new Error(`--${key} does not take a value`);
      opts[key] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(key) && !REPEATABLE_FLAGS.has(key)) throw new Error(`Unknown option --${key}`);
    let value = inlineValue;
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    if (REPEATABLE_FLAGS.has(key)) {
      if (!opts[key]) opts[key] = [];
      opts[key].push(value);
      continue;
    }
    if (opts[key] !== undefined) throw new Error(`--${key} was provided more than once`);
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
      id: "approve_all_p0",
      label: "批准全部 P0 并写回",
      command: `./scripts/shopify-geo-optimizer.sh apply --group-id ${id} --confirm --approve-all-p0`,
    },
    {
      id: "dry_run",
      label: "离线演练（fixture after 分，不调用 Shopify）",
      command: `./scripts/shopify-geo-optimizer.sh apply --group-id ${id} --confirm --approve-all-p0 --dry-run`,
    },
  ];
}

function asList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function readInputs(groupDir) {
  const beforePath = path.join(groupDir, BEFORE_FILENAME);
  const briefPath = path.join(groupDir, BRIEF_FILENAME);
  if (!(await pathExists(beforePath))) {
    throw new Error(
      "geo.before.json not found. Run shopify-geo-eval-workshop apply --confirm before the optimizer.",
    );
  }
  if (!(await pathExists(briefPath))) {
    throw new Error("brand-brief.json not found. Run brand-intake apply --confirm before the optimizer.");
  }
  const scorecard = await readJsonFile(beforePath);
  const brief = await readJsonFile(briefPath);
  await assertWorkshopScorecard(scorecard);
  return { scorecard, brief };
}

function assertStoreMatch(scorecard, connection) {
  const store = String(scorecard.store || "").trim().toLowerCase();
  if (store !== connection.store) {
    throw new Error(
      `geo.before.json store (${scorecard.store || "missing"}) does not match the Preview Store connection (${connection.store}).`,
    );
  }
}

async function extraFieldsFor(groupDir) {
  const previewPath = path.join(groupDir, "products.import.preview.json");
  if (!(await pathExists(previewPath))) return new Map();
  return extraFieldsFromPreview(await readJsonFile(previewPath));
}

async function proposalFor(groupDir, { scorecard, brief, groupId, rebuild }) {
  const proposalPath = path.join(groupDir, PROPOSAL_FILENAME);
  if (!rebuild && (await pathExists(proposalPath))) {
    return readJsonFile(proposalPath);
  }
  const proposal = buildProposal({
    scorecard,
    brief,
    groupId,
    extraFields: await extraFieldsFor(groupDir),
  });
  assertNoSensitiveKeys(proposal, "proposal");
  return proposal;
}

function optimizerStatusFor(opts, approved) {
  if (opts["approve-all-p0"] || approved.mode === "approve_all_p0") return "approved_p0_batch";
  return "applied";
}

async function commitArtifacts(groupDir, connection, files, output) {
  const outputText = `${JSON.stringify(output, null, 2)}\n`;
  for (const file of files) assertNoRawAccessUrl(file.text, connection.accessUrlForGuard);
  assertNoRawAccessUrl(outputText, connection.accessUrlForGuard);
  await ensureWorkshopGitignore(groupDir);
  for (const file of files) {
    if (file.json) await writePrivateJson(file.path, file.json);
    else await writePrivateText(file.path, file.text);
  }
  return output;
}

async function runPlan(opts) {
  const groupDir = resolveGroupDir(opts);
  const connection = await readOptimizerConnection(groupDir);
  const groupId = groupIdFrom(opts, groupDir);
  const { scorecard, brief } = await readInputs(groupDir);
  assertStoreMatch(scorecard, connection);
  const proposal = await proposalFor(groupDir, { scorecard, brief, groupId, rebuild: true });
  const proposalPath = path.join(groupDir, PROPOSAL_FILENAME);
  const output = {
    ...proposal,
    command: "plan",
    dry_run: false,
    shopify_called: false,
    eval_called: false,
    products_touched: false,
    theme_touched: false,
    mutations: false,
    participant_confirm_copy: CONFIRM_COPY,
    continuations: continuationCommands(groupId),
    note: "Proposal only. Approve P0 in one batch. Deep review is optional and limited to 1–2 products. P1 stays collapsed.",
    artifacts: {
      geo_proposal_json: relativeArtifactPath(proposalPath),
    },
  };
  const text = `${JSON.stringify(proposal, null, 2)}\n`;
  return commitArtifacts(groupDir, connection, [{ path: proposalPath, json: proposal, text }], output);
}

async function approvedSet(opts, groupDir, proposal, brief) {
  const avoid = readConstraints(brief).avoid;
  if (opts["approve-all-p0"]) {
    return approveAllP0(proposal, {
      deepReviewHandles: asList(opts["deep-review"]),
      ignored: asList(opts.ignore),
      avoid,
    });
  }
  const approvedPath = path.join(groupDir, APPROVED_FILENAME);
  if (!(await pathExists(approvedPath))) {
    throw new Error(
      "Refusing to write without an approved set. Re-run with --approve-all-p0, or provide geo.approved.json.",
    );
  }
  return acceptApprovedFile(await readJsonFile(approvedPath), avoid);
}

async function runApply(opts) {
  if (!opts.confirm) {
    throw new Error(
      "Refusing to apply without --confirm. Review geo.proposal.json and obtain human confirmation outside the CLI.",
    );
  }

  const groupDir = resolveGroupDir(opts);
  const connection = await readOptimizerConnection(groupDir);
  const groupId = groupIdFrom(opts, groupDir);
  const dryRun = Boolean(opts["dry-run"]);
  const { scorecard, brief } = await readInputs(groupDir);
  assertStoreMatch(scorecard, connection);
  const constraints = readConstraints(brief);
  const proposal = await proposalFor(groupDir, { scorecard, brief, groupId, rebuild: false });
  const approved = await approvedSet(opts, groupDir, proposal, brief);
  assertNoSensitiveKeys(approved, "approved");

  const proposalPath = path.join(groupDir, PROPOSAL_FILENAME);
  const approvedPath = path.join(groupDir, APPROVED_FILENAME);
  const afterPath = path.join(groupDir, AFTER_FILENAME);
  const afterMarkdownPath = path.join(groupDir, AFTER_MARKDOWN_FILENAME);
  const statePath = path.join(groupDir, "workshop-state.yaml");
  const status = optimizerStatusFor(opts, approved);

  await commitArtifacts(groupDir, connection, [
    { path: proposalPath, json: proposal, text: `${JSON.stringify(proposal, null, 2)}\n` },
    { path: approvedPath, json: approved, text: `${JSON.stringify(approved, null, 2)}\n` },
  ], { ok: true, command: "apply", phase: "approved", dry_run: dryRun, store: connection.store });

  let afterScorecard;
  let shopifyCalled = false;
  let evalCalled = false;
  let productsUpdated = 0;
  let afterSource = "fixture";

  if (dryRun) {
    afterScorecard = await loadFixtureAfterScore({ before: scorecard, store: connection.store });
  } else {
    const updated = await updateApprovedProducts({
      domain: connection.store,
      suggestions: approved.suggestions,
      constraints,
    });
    shopifyCalled = true;
    productsUpdated = updated.length;
    await rescoreWithWorkshopEval({
      groupDir,
      skipHtml: scorecard.evidence_mode === "admin_only",
    });
    evalCalled = true;
    afterSource = "shopify-geo-eval-workshop";
    if (!(await pathExists(afterPath))) {
      throw new Error("shopify-geo-eval-workshop did not write geo.after.json");
    }
    afterScorecard = await readJsonFile(afterPath);
    await assertWorkshopScorecard(afterScorecard);
  }

  const afterScore = afterScorecard.geo_score;
  if (!Number.isInteger(afterScore)) {
    throw new Error("geo.after.json geo_score must be an integer");
  }
  const existingState = await readTextOrEmpty(statePath);
  const nextState = updateOptimizerState(existingState || connection.stateText, {
    afterScore,
    optimizerStatus: status,
  });
  const afterMarkdown = dryRun
    ? `${renderFixtureAfterMarkdown(afterScorecard).replace(/\n+$/, "")}\n`
    : null;

  const output = {
    ok: true,
    command: "apply",
    dry_run: dryRun,
    group_id: groupId,
    store: connection.store,
    store_type: "preview",
    shopify_called: shopifyCalled,
    eval_called: evalCalled,
    eval_runtime: "shopify-geo-eval-workshop",
    after_score_source: afterSource,
    products_updated: productsUpdated,
    approved_count: approved.suggestions.length,
    p1_written: 0,
    deep_review_handles: approved.deep_review_handles || [],
    line_by_line_review: false,
    optimizer_status: status,
    before_score: scorecard.geo_score,
    after_score: afterScore,
    products_touched: shopifyCalled,
    theme_touched: false,
    mutations: shopifyCalled,
    state_updated: true,
    artifacts: {
      geo_proposal_json: relativeArtifactPath(proposalPath),
      geo_approved_json: relativeArtifactPath(approvedPath),
      geo_after_json: relativeArtifactPath(afterPath),
      workshop_state_yaml: relativeArtifactPath(statePath),
    },
  };
  if (dryRun) {
    output.fixture_used = "fixtures/geo.after.json";
    output.artifacts.geo_after_md = relativeArtifactPath(afterMarkdownPath);
  }

  const files = [{ path: statePath, text: nextState }];
  if (dryRun) {
    files.push(
      { path: afterPath, json: afterScorecard, text: `${JSON.stringify(afterScorecard, null, 2)}\n` },
      { path: afterMarkdownPath, text: afterMarkdown },
    );
  }
  return commitArtifacts(groupDir, connection, files, output);
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.version) {
    process.stdout.write(`${JSON.stringify({ runtime: "shopify-geo-optimizer", version: "0.1.0" })}\n`);
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
    const hints = error.hints || [
      "Run plan --group-id <id> and review geo.proposal.json with a human.",
      "Apply with --confirm --approve-all-p0. Add --dry-run to skip Shopify.",
      "P1 stays collapsed. Deep review is optional and limited to 1–2 products.",
    ];
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          error: redactSensitiveText(error.message),
          hints,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  });
}

export { CONFIRM_COPY };
