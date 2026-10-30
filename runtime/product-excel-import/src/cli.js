#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPreview } from "./products.js";
import { importPreview } from "./shopify.js";
import { readPreviewConnection } from "./connection.js";
import {
  ensureWorkshopGitignore,
  pathExists,
  readJsonFile,
  relativeArtifactPath,
  writePrivateJson,
} from "./files.js";
import { assertArtifactSafe, redactSensitiveText } from "./redact.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

const BOOLEAN_FLAGS = new Set([
  "help",
  "version",
  "json",
  "dry-run",
  "demo-images",
  "check-images",
  "confirm",
]);

const VALUE_FLAGS = new Set([
  "group-id",
  "group-dir",
  "workdir",
  "file",
  "input",
  "source",
  "preview",
  "fixtures-dir",
]);

function usage() {
  return `ShopWright Workshop — product Excel/CSV import runtime

Usage:
  node src/cli.js validate --group-id <id> --file <products.csv|products.xlsx> [options]
  node src/cli.js import   --group-id <id> [--preview <path>] [--confirm] [--dry-run]
  node src/cli.js run      --group-id <id> --file <products.csv|products.xlsx> [--confirm] [options]

Options:
  --file <path>          CSV or XLSX product sheet (also accepts --input/--source)
  --workdir <dir>        Parent workshop workspace (default: .workshop)
  --group-dir <dir>      Explicit group directory override
  --preview <path>       Preview artifact for import (default: .workshop/<id>/products.import.preview.json)
  --demo-images          Replace missing/unreachable image_url values with a Shopify placeholder
  --check-images         Probe image_url reachability (off by default for offline workshops)
  --confirm              Required for a real Shopify import; confirmation happens outside this CLI
  --dry-run              Never call Shopify; use bundled fixtures for fake import results
  --fixtures-dir <dir>   Fixture directory for dry-run import results
  --json                 Accepted for agent compatibility; JSON output is the default
  --help                 Show this help

Artifacts:
  .workshop/<group-id>/products.import.preview.json
  .workshop/<group-id>/products.import.result.json

Safety:
  - Import refuses a missing connection.json or any store_type other than preview.
  - Only writes Draft products. Never publishes Online Store or any sales channel.
  - Never writes accessUrl, access tokens, or storefront passwords.
  - Unknown columns (for example source_url) are ignored safely.
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

function resolveGroupDir(opts, { required = true } = {}) {
  if (opts["group-dir"]) return path.resolve(opts["group-dir"]);
  if (!opts["group-id"]) {
    if (required) throw new Error("--group-id or --group-dir is required");
    return null;
  }
  return path.resolve(opts.workdir || ".workshop", validateGroupId(opts["group-id"]));
}

function sourceFileFromOpts(opts) {
  return requireString(opts.file || opts.input || opts.source, "--file");
}

function previewPath(groupDir) {
  return path.join(groupDir, "products.import.preview.json");
}

function resultPath(groupDir) {
  return path.join(groupDir, "products.import.result.json");
}

async function writeSafeJson(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertArtifactSafe(serialized);
  await writePrivateJson(filePath, value);
  return serialized;
}

function summarize(preview) {
  return {
    total_rows: preview.total_rows,
    ready: preview.ready,
    warning: preview.warning,
    blocked: preview.blocked,
    importable: preview.importable,
    default_status: preview.default_status,
  };
}

async function validateToArtifact(opts) {
  const groupDir = resolveGroupDir(opts);
  const file = path.resolve(sourceFileFromOpts(opts));
  if (!(await pathExists(file))) throw new Error(`Product file not found: ${file}`);
  const preview = await buildPreview({
    filePath: relativeArtifactPath(file),
    demoImages: Boolean(opts["demo-images"]),
    checkImages: Boolean(opts["check-images"]),
    dryRun: Boolean(opts["dry-run"]),
  });
  await ensureWorkshopGitignore(groupDir);
  const artifactPath = previewPath(groupDir);
  await writeSafeJson(artifactPath, preview);
  return {
    preview,
    groupDir,
    artifacts: { preview_json: relativeArtifactPath(artifactPath) },
  };
}

async function importFromArtifact(opts, { previewOverride = null, validation = null } = {}) {
  const groupDir = resolveGroupDir(opts);
  const connection = await readPreviewConnection(groupDir);
  let preview = previewOverride;
  if (!preview) {
    const source = opts.preview ? path.resolve(opts.preview) : previewPath(groupDir);
    if (!(await pathExists(source))) {
      throw new Error(`Preview artifact not found at ${source}. Run validate first and review the result.`);
    }
    preview = await readJsonFile(source);
  }
  if (!Array.isArray(preview.products)) throw new Error("Preview artifact does not contain a products array");
  if (!opts["dry-run"] && !opts.confirm) {
    throw new Error("Refusing to import without --confirm. Review products.import.preview.json and obtain human confirmation outside the CLI.");
  }

  const result = await importPreview({
    preview,
    domain: connection.store,
    dryRun: Boolean(opts["dry-run"]),
    fixturesDir: path.resolve(opts["fixtures-dir"] || DEFAULT_FIXTURES_DIR),
  });
  const artifactPath = resultPath(groupDir);
  await writeSafeJson(artifactPath, result);

  const output = {
    ok: result.failed === 0,
    command: validation ? "run" : "import",
    dry_run: Boolean(opts["dry-run"]),
    ...summarize(preview),
    imported: result.imported,
    failed: result.failed,
    skipped_blocked: result.skipped_blocked,
    shopify_status: "draft",
    channels_published: false,
    store: connection.store,
    results: result.results,
    artifacts: {
      ...(validation?.artifacts ?? {}),
      result_json: relativeArtifactPath(artifactPath),
    },
  };
  if (opts["dry-run"]) output.fixture_used = "fixtures/product-create.success.json";
  return { result, output, groupDir };
}

async function runValidate(opts) {
  const validation = await validateToArtifact(opts);
  return {
    ok: true,
    command: "validate",
    dry_run: Boolean(opts["dry-run"]),
    ...summarize(validation.preview),
    shopify_status: "draft",
    channels_published: false,
    preview: validation.preview,
    artifacts: validation.artifacts,
    next: "Review products.import.preview.json, obtain human confirmation, then run import --confirm or run --confirm.",
  };
}

async function runImport(opts) {
  const imported = await importFromArtifact(opts);
  return imported.output;
}

async function runEndToEnd(opts) {
  const validation = await validateToArtifact(opts);
  const shouldImport = Boolean(opts["dry-run"] || opts.confirm);
  if (!shouldImport) {
    return {
      ok: true,
      command: "run",
      dry_run: false,
      ...summarize(validation.preview),
      imported: 0,
      failed: 0,
      shopify_status: "draft",
      channels_published: false,
      preview: validation.preview,
      artifacts: validation.artifacts,
      next: "Preview written. Review it, obtain human confirmation, then rerun with --confirm to import Draft products.",
    };
  }
  const imported = await importFromArtifact(opts, { previewOverride: validation.preview, validation });
  return imported.output;
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.version) {
    process.stdout.write(`${JSON.stringify({ runtime: "product-excel-import", version: "0.1.0" })}\n`);
    return;
  }
  if (command === "help" || command === "--help" || opts.help) {
    process.stdout.write(usage());
    return;
  }

  let output;
  switch (command) {
    case "validate":
      output = await runValidate(opts);
      break;
    case "import":
      output = await runImport(opts);
      break;
    case "run":
      output = await runEndToEnd(opts);
      break;
    default:
      throw new Error(`Unknown command "${command}". Run with --help for usage.`);
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.failed > 0) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        error: redactSensitiveText(error.message),
        hints: [
          "Run validate first and review products.import.preview.json.",
          "Use --dry-run to exercise the end-to-end path without network writes.",
          "Import only requires a Preview Store connection.json with write_products scope.",
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
});
