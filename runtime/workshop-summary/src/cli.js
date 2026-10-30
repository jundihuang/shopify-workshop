#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureWorkshopGitignore,
  relativeArtifactPath,
  writePrivateJson,
  writePrivateText,
} from "./files.js";
import { SummaryRefusal, loadWorkshopBundle } from "./load.js";
import {
  PLAN_FILENAME,
  STATE_FILENAME,
  SUMMARY_HTML_FILENAME,
  SUMMARY_JSON_FILENAME,
  SUMMARY_MARKDOWN_FILENAME,
  defaultFixturesDir,
} from "./paths.js";
import { assertArtifactSafe, assertNoRawAccessUrl, redactSensitiveText } from "./redact.js";
import { buildSummaryModel, renderHtml, renderMarkdown } from "./summary.js";
import { updateSummaryState } from "./state.js";

const CONFIRM_COPY = "「生成 Workshop Summary（不调用 Shopify，不写入 accessUrl）」";
const PASSWORD_FLAGS = new Set(["password", "storefront-password", "opening-soon-password"]);
const BOOLEAN_FLAGS = new Set(["help", "version", "json", "dry-run", "confirm"]);
const VALUE_FLAGS = new Set(["group-id", "group-dir", "workdir", "fixtures-dir"]);

function usage() {
  return `ShopWright Workshop — generate_workshop_summary runtime

Usage:
  node src/cli.js plan  (--group-id <id> | --group-dir <dir>) [--dry-run]
  node src/cli.js apply (--group-id <id> | --group-dir <dir>) --confirm [--dry-run]

Options:
  --group-id <id>        Workshop group id; artifacts live under .workshop/<id>/
  --group-dir <dir>      Explicit group directory override
  --workdir <dir>        Parent workshop workspace (default: .workshop)
  --confirm              Required for apply, including --dry-run.
                         Human confirmation happens outside this CLI.
  --dry-run              Local rehearsal. This step never calls Shopify.
                         Missing or unreadable group artifacts are filled from fixtures.
                         Present group files are kept. Nothing is written back into
                         geo.after.json or other earlier-step artifacts.
  --fixtures-dir <dir>   Fixture directory for --dry-run (default: runtime fixtures)
  --json                 Accepted for agent compatibility; output is JSON by default
  --help                 Show this help

Commands:
  ./scripts/workshop-summary.sh plan --group-id A
  ./scripts/workshop-summary.sh apply --group-id A --confirm
  ./scripts/workshop-summary.sh apply --group-id A --confirm --dry-run

Reads:
  .workshop/<group-id>/connection.json
  .workshop/<group-id>/products.import.result.json
  .workshop/<group-id>/products.channel.json
  .workshop/<group-id>/brand-brief.json
  .workshop/<group-id>/theme.manifest.json
  .workshop/<group-id>/geo.before.json
  .workshop/<group-id>/geo.proposal.json
  .workshop/<group-id>/geo.approved.json
  .workshop/<group-id>/geo.after.json
  .workshop/<group-id>/workshop-state.yaml

Writes:
  .workshop/<group-id>/workshop-summary.plan.json   # plan
  .workshop/<group-id>/workshop-summary.md          # apply
  .workshop/<group-id>/workshop-summary.html        # apply
  .workshop/<group-id>/workshop-summary.json        # apply
  .workshop/<group-id>/workshop-state.yaml          # summary.status done | demo

Safety:
  - Final step after geo-optimizer. No Shopify CLI or Admin calls.
  - Preview Store is the only store path.
  - Scores are copied from the shopify-geo-eval-workshop scorecard.
  - This is a workshop scorecard, not the full diagnostic.
  - apply refuses to run without --confirm, including --dry-run.
  - Never persists accessUrl, admin tokens, or a storefront password.
  - Does not publish the theme and does not change products.
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
      throw new SummaryRefusal(
        "Refusing a storefront password flow. The workshop summary does not accept an Opening soon password.",
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

function fixturesDirFrom(opts) {
  return opts["fixtures-dir"] ? path.resolve(opts["fixtures-dir"]) : defaultFixturesDir();
}

function continuationCommands(groupId) {
  const id = shellQuote(groupId);
  return [
    {
      id: "write_summary",
      label: "确认并写出 Workshop Summary",
      command: `./scripts/workshop-summary.sh apply --group-id ${id} --confirm`,
    },
    {
      id: "dry_run",
      label: "离线演练（缺的产物用 fixture 补齐，不调用 Shopify）",
      command: `./scripts/workshop-summary.sh apply --group-id ${id} --confirm --dry-run`,
    },
  ];
}

function riskOneLiner(model) {
  const parts = ["将生成本组 Workshop Summary（Markdown + HTML）"];
  if (model.gaps.length > 0) parts.push(`交付清单还有 ${model.gaps.length} 项需要留意`);
  if (model.dry_run && model.fixture_filled.length > 0) {
    parts.push(`dry-run 会用 fixture 补齐 ${model.fixture_filled.length} 份缺失产物`);
  }
  parts.push("不调用 Shopify，不改商品，不发布主题，不写入 accessUrl");
  return `${parts.join("；")}。`;
}

function assertOutputSafe(serialized, guardSecrets) {
  assertNoRawAccessUrl(serialized, null);
  assertArtifactSafe(serialized);
  for (const secret of guardSecrets || []) {
    if (secret && serialized.includes(secret)) {
      throw new Error("Refusing to write an artifact containing a raw accessUrl");
    }
  }
  return serialized;
}

async function writeSafeJson(filePath, value, guardSecrets) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertOutputSafe(serialized, guardSecrets);
  await writePrivateJson(filePath, value);
  return serialized;
}

async function writeSafeText(filePath, text, guardSecrets) {
  assertOutputSafe(text, guardSecrets);
  await writePrivateText(filePath, text.endsWith("\n") ? text : `${text}\n`);
}

async function readModel(opts) {
  const groupDir = resolveGroupDir(opts);
  const groupId = groupIdFrom(opts, groupDir);
  const bundle = await loadWorkshopBundle({
    groupDir,
    dryRun: Boolean(opts["dry-run"]),
    fixturesDir: fixturesDirFrom(opts),
  });
  const model = buildSummaryModel({ groupId, bundle });
  return { groupDir, groupId, bundle, model };
}

async function runPlan(opts) {
  const { groupDir, model, bundle } = await readModel(opts);
  const plan = {
    ok: true,
    artifact: PLAN_FILENAME,
    schema_version: "1.0",
    command: "plan",
    step: "generate_workshop_summary",
    group_id: model.group_id,
    store: model.store,
    store_type: model.store_type,
    dry_run: model.dry_run,
    shopify_called: false,
    theme_touched: false,
    products_touched: false,
    writes_summary: false,
    summary_status_on_apply: model.summary_status,
    sources: model.sources,
    fixture_filled: model.fixture_filled,
    checklist: model.checklist,
    checklist_complete: model.checklist_complete,
    scores: {
      before: model.scores.before,
      after: model.scores.after,
      improvement: model.scores.improvement,
    },
    gaps: model.gaps,
    notes: model.notes,
    participant_confirm_copy: CONFIRM_COPY,
    risk_one_liner: riskOneLiner(model),
    continuations: continuationCommands(model.group_id),
  };
  await ensureWorkshopGitignore(groupDir);
  const artifactPath = path.join(groupDir, PLAN_FILENAME);
  await writeSafeJson(artifactPath, plan, bundle.guardSecrets);
  return {
    ...plan,
    artifacts: {
      plan_json: relativeArtifactPath(artifactPath),
    },
    next: "Review the delivery checklist and participant_confirm_copy with a human, then run apply --confirm. Add --dry-run to fill missing artifacts from fixtures.",
  };
}

async function runApply(opts) {
  if (!opts.confirm) {
    throw new Error(
      "Refusing to apply without --confirm. Review workshop-summary.plan.json and obtain human confirmation outside the CLI.",
    );
  }
  const { groupDir, model, bundle } = await readModel(opts);
  const markdown = renderMarkdown(model);
  const html = renderHtml(model);
  const markdownPath = path.join(groupDir, SUMMARY_MARKDOWN_FILENAME);
  const htmlPath = path.join(groupDir, SUMMARY_HTML_FILENAME);
  const jsonPath = path.join(groupDir, SUMMARY_JSON_FILENAME);
  const statePath = path.join(groupDir, STATE_FILENAME);
  const nextState = updateSummaryState(bundle.stateText, {
    status: model.summary_status,
    beforeScore: model.scores.before,
    afterScore: model.scores.after,
    improvement: model.scores.improvement,
  });

  await ensureWorkshopGitignore(groupDir);
  await writeSafeText(markdownPath, markdown, bundle.guardSecrets);
  await writeSafeText(htmlPath, html, bundle.guardSecrets);
  await writeSafeJson(jsonPath, model, bundle.guardSecrets);
  await writeSafeText(statePath, nextState, bundle.guardSecrets);

  const output = {
    ok: true,
    command: "apply",
    step: "generate_workshop_summary",
    group_id: model.group_id,
    store: model.store,
    store_type: model.store_type,
    dry_run: model.dry_run,
    shopify_called: false,
    theme_touched: false,
    products_touched: false,
    summary_status: model.summary_status,
    before_score: model.scores.before,
    after_score: model.scores.after,
    improvement: model.scores.improvement,
    checklist_complete: model.checklist_complete,
    fixture_filled: model.fixture_filled,
    gaps: model.gaps,
    state_updated: true,
    artifacts: {
      workshop_summary_md: relativeArtifactPath(markdownPath),
      workshop_summary_html: relativeArtifactPath(htmlPath),
      workshop_summary_json: relativeArtifactPath(jsonPath),
      workshop_state_yaml: relativeArtifactPath(statePath),
    },
  };
  assertOutputSafe(JSON.stringify(output), bundle.guardSecrets);
  return output;
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.version) {
    process.stdout.write(`${JSON.stringify({ runtime: "workshop-summary", version: "0.1.0" })}\n`);
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
      "Run plan --group-id <id> and review workshop-summary.plan.json with a human.",
      "Apply with --confirm. Add --dry-run to fill missing artifacts from fixtures.",
      "This step does not call Shopify. Preview Store is the only store path.",
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
