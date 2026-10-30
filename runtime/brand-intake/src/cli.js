#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureWorkshopGitignore,
  readJsonFile,
  readTextOrEmpty,
  relativeArtifactPath,
  writePrivateJson,
  writePrivateText,
} from "./files.js";
import { buildBriefFromAnswers, buildBriefFromDemo } from "./normalize.js";
import { BRIEF_FILENAME, PLAN_FILENAME, defaultDemoPath, defaultSchemaPath, repoRelative } from "./paths.js";
import { assertArtifactSafe, redactSensitiveText } from "./redact.js";
import { formatSchemaErrors, loadBrandBriefSchema, validateBrandBrief } from "./schema.js";
import { BRIEF_FILE_NAME, updateBrandState } from "./state.js";

const CONFIRM_COPY = "「锁定 Brand Brief，供骨架 Theme 填充与 GEO 文案约束使用（不写 Shopify）」";

const BOOLEAN_FLAGS = new Set(["help", "version", "json", "dry-run", "confirm", "demo"]);
const VALUE_FLAGS = new Set([
  "group-id",
  "group-dir",
  "workdir",
  "answers",
  "demo-file",
  "schema",
]);

function usage() {
  return `ShopWright Workshop — brand intake runtime

Usage:
  node src/cli.js plan  (--group-id <id> | --group-dir <dir>) (--answers <file> | --demo) [--dry-run]
  node src/cli.js apply (--group-id <id> | --group-dir <dir>) --confirm (--answers <file> | --demo) [--dry-run]

Options:
  --group-id <id>        Workshop group id; artifacts live under .workshop/<id>/
  --group-dir <dir>      Explicit group directory override
  --workdir <dir>        Parent workshop workspace (default: .workshop)
  --answers <file>       Student brand answers JSON (flat or nested)
  --demo                 Load the Aurora Skincare Demo Brief instead of answers
  --demo-file <file>     Override the Demo Brief JSON (implies nothing by itself; use with --demo)
  --confirm              Required for apply, including --dry-run. Human confirmation happens
                         outside this CLI after reviewing the plan.
  --dry-run              Local rehearsal. This step never calls Shopify either way.
                         apply --dry-run --demo writes the Demo Brief without an answers file.
  --schema <file>        Brand brief JSON Schema override (default: templates/brand-brief.schema.json)
  --json                 Accepted for agent compatibility; output is JSON by default
  --help                 Show this help

Artifacts:
  .workshop/<group-id>/brand-brief.plan.json   # plan only; not the locked brief
  .workshop/<group-id>/brand-brief.json        # apply only
  .workshop/<group-id>/workshop-state.yaml     # brand.status done | fallback_demo

Safety:
  - Local JSON only. Never calls Shopify, never edits a theme, never writes products.
  - Never reads or persists accessUrl, tokens, or the storefront password.
  - Preview Store remains the only workshop store path. This step does not open a store.
  - apply refuses to run without --confirm, including --dry-run.
  - plan validates and lists missing[] plus tone.avoid risk flags. It does not write the brief.
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

async function writeSafeJson(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertArtifactSafe(serialized);
  await writePrivateJson(filePath, value);
  return serialized;
}

function riskOneLiner({ missing, riskFlags, demo }) {
  if (demo) {
    return "将加载预置 Demo Brief（Aurora Skincare）。不连接 Shopify，不改 Theme，不改商品。";
  }
  const parts = [];
  if (missing.length > 0) {
    parts.push(`缺少 ${missing.length} 个字段，确认后用默认值补齐并写入 missing[]`);
  }
  if (riskFlags.length > 0) {
    parts.push(`${riskFlags.length} 条夸大/医疗风险表述将写入 tone.avoid`);
  }
  if (parts.length === 0) parts.push("Brief 字段齐全");
  parts.push("不连接 Shopify，不改 Theme，不改商品");
  return `${parts.join("；")}。`;
}

function continuationCommands(groupId, { answersRel, demo }) {
  const commands = [];
  if (!demo) {
    const answersFlag = answersRel ? ` --answers ${shellQuote(answersRel)}` : "";
    commands.push({
      id: "continue_with_defaults",
      label: "用默认值继续",
      command: `./scripts/brand-intake.sh apply --group-id ${groupId}${answersFlag} --confirm`,
    });
  }
  commands.push({
    id: "load_demo_brief",
    label: "加载 Demo Brief（Aurora Skincare）",
    command: `./scripts/brand-intake.sh apply --group-id ${groupId} --demo --confirm`,
  });
  return commands;
}

async function prepareBrief(opts) {
  if (opts["demo-file"] && !opts.demo) {
    throw new Error("--demo-file is only used together with --demo");
  }
  const schema = await loadBrandBriefSchema(opts.schema ? path.resolve(opts.schema) : defaultSchemaPath());

  if (opts.demo) {
    const demoPath = path.resolve(opts["demo-file"] || defaultDemoPath());
    const prepared = buildBriefFromDemo(await readJsonFile(demoPath));
    assertValid(prepared.brief, schema);
    return { ...prepared, schema, demoPath, answersPath: null, answersIgnored: Boolean(opts.answers) };
  }

  if (!opts.answers) {
    throw new Error("Provide --answers <file> or --demo to load the Aurora Skincare brief.");
  }
  const answersPath = path.resolve(opts.answers);
  const prepared = buildBriefFromAnswers(await readJsonFile(answersPath));
  assertValid(prepared.brief, schema);
  return { ...prepared, schema, demoPath: null, answersPath, answersIgnored: false };
}

function assertValid(brief, schema) {
  const errors = validateBrandBrief(brief, schema);
  if (errors.length > 0) {
    throw new Error(`Brand brief failed schema validation: ${formatSchemaErrors(errors)}`);
  }
}

function planDocument(opts, groupDir, prepared) {
  const groupId = groupIdFrom(opts, groupDir);
  const demo = prepared.source === "demo";
  const answersRel = prepared.answersPath ? relativeArtifactPath(prepared.answersPath) : null;
  return {
    ok: true,
    artifact: PLAN_FILENAME,
    schema_version: "1.0",
    command: "plan",
    group_id: groupId,
    source: prepared.source,
    demo,
    dry_run: Boolean(opts["dry-run"]),
    answers_file: demo ? null : answersRel,
    answers_ignored: prepared.answersIgnored,
    missing: prepared.missing,
    risk_flags: prepared.risk_flags,
    tone_avoid: prepared.brief.tone.avoid,
    derived: prepared.derived,
    schema_valid: true,
    participant_confirm_copy: CONFIRM_COPY,
    risk_one_liner: riskOneLiner({ missing: prepared.missing, riskFlags: prepared.risk_flags, demo }),
    continuations: continuationCommands(groupId, { answersRel, demo }),
    normalized_brief: prepared.brief,
    shopify_called: false,
    theme_touched: false,
    products_touched: false,
    writes_brief: false,
  };
}

async function runPlan(opts) {
  const groupDir = resolveGroupDir(opts);
  const prepared = await prepareBrief(opts);
  const plan = planDocument(opts, groupDir, prepared);
  await ensureWorkshopGitignore(groupDir);
  const artifactPath = path.join(groupDir, PLAN_FILENAME);
  await writeSafeJson(artifactPath, plan);
  return {
    ...plan,
    artifacts: {
      plan_json: relativeArtifactPath(artifactPath),
    },
    next: "Review missing[], risk_flags, and participant_confirm_copy with a human, then run apply --confirm. Use --demo for the Aurora Skincare brief.",
  };
}

async function runApply(opts) {
  const groupDir = resolveGroupDir(opts);
  if (!opts.confirm) {
    throw new Error(
      "Refusing to apply without --confirm. Review brand-brief.plan.json and obtain human confirmation outside the CLI.",
    );
  }

  const prepared = await prepareBrief(opts);
  const dryRun = Boolean(opts["dry-run"]);
  const demo = prepared.source === "demo";
  const status = demo ? "fallback_demo" : "done";
  const briefPath = path.join(groupDir, BRIEF_FILENAME);

  await ensureWorkshopGitignore(groupDir);
  await writeSafeJson(briefPath, prepared.brief);

  const statePath = path.join(groupDir, "workshop-state.yaml");
  const existingState = await readTextOrEmpty(statePath);
  const nextState = updateBrandState(existingState, { briefFile: BRIEF_FILE_NAME, status });
  assertArtifactSafe(nextState);
  await writePrivateText(statePath, nextState);

  const output = {
    ok: true,
    command: "apply",
    dry_run: dryRun,
    source: prepared.source,
    demo,
    brand_name: prepared.brief.brand_name,
    status,
    missing: prepared.missing,
    risk_flags: prepared.risk_flags,
    tone_avoid: prepared.brief.tone.avoid,
    schema_valid: true,
    confirmation: "--confirm",
    shopify_called: false,
    theme_touched: false,
    products_touched: false,
    state_updated: true,
    artifacts: {
      brand_brief_json: relativeArtifactPath(briefPath),
      workshop_state_yaml: relativeArtifactPath(statePath),
    },
  };
  if (demo) output.fixture_used = repoRelative(prepared.demoPath);
  return output;
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.version) {
    process.stdout.write(`${JSON.stringify({ runtime: "brand-intake", version: "0.1.0" })}\n`);
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

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
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
            "Run plan --answers <file> or plan --demo and review missing[] and risk_flags with a human.",
            "Use apply --confirm to lock the brief, or apply --demo --dry-run --confirm to write the Aurora Skincare fixture.",
            "This step never calls Shopify and never writes accessUrl.",
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
