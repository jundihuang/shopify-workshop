#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readThemeConnection } from "./connection.js";
import { fillSkeleton, publicFill, summarizeFill } from "./fill.js";
import {
  ensureWorkshopGitignore,
  pathExists,
  readJsonFile,
  readTextOrEmpty,
  relativeArtifactPath,
  writePrivateJson,
  writePrivateText,
} from "./files.js";
import { buildManifest, loadDemoManifest, loadDryRunManifest, parseDemoThemeId } from "./manifest.js";
import {
  MANIFEST_FILENAME,
  PLAN_FILENAME,
  PAGES,
  THEME_WORK_DIRNAME,
  defaultDemoManifestPath,
  defaultPushFixturePath,
  defaultSkeletonDir,
  repoRelative,
} from "./paths.js";
import { assertArtifactSafe, assertNoRawAccessUrl, redactSensitiveText } from "./redact.js";
import { pushUnpublishedTheme, resolveThemeUpload } from "./shopify.js";
import { updateThemeState } from "./state.js";

const CONFIRM_COPY = "「填充骨架并 push 为 Unpublished Theme（不发布主题，不改商品渠道）」";

const BOOLEAN_FLAGS = new Set(["help", "version", "json", "dry-run", "confirm", "demo"]);
const VALUE_FLAGS = new Set([
  "group-id",
  "group-dir",
  "workdir",
  "fixtures-dir",
  "demo-manifest",
  "skeleton",
]);

function usage() {
  return `ShopWright Workshop — shopify theme builder runtime

Usage:
  node src/cli.js plan  (--group-id <id> | --group-dir <dir>) [--demo]
  node src/cli.js apply (--group-id <id> | --group-dir <dir>) --confirm [--dry-run] [--demo]

Options:
  --group-id <id>         Workshop group id; artifacts live under .workshop/<id>/
  --group-dir <dir>       Explicit group directory override
  --workdir <dir>         Parent workshop workspace (default: .workshop)
  --confirm               Required for apply, including --dry-run and --demo.
                          Human confirmation happens outside this CLI after reviewing the plan.
  --dry-run               Do not call the Shopify CLI. Write a fixture unpublished manifest.
  --demo                  Force the documented Demo Theme fallback (no upload).
  --skeleton <dir>        Theme skeleton directory override
  --demo-manifest <file>  Demo Theme manifest override
  --fixtures-dir <dir>    Directory containing theme-push.unpublished.success.json
  --json                  Accepted for agent compatibility; output is JSON by default
  --help                  Show this help

Artifacts:
  .workshop/<group-id>/theme.plan.json
  .workshop/<group-id>/theme-work/            # filled skeleton (apply, except --demo)
  .workshop/<group-id>/theme.manifest.json    # apply only
  .workshop/<group-id>/workshop-state.yaml    # theme.theme_id, status, preview_url, fallback_used

Safety:
  - Preview Store only. Requires connection.json with write_themes.
  - Fills the skeleton from brand-brief.json. Does not generate a theme from scratch.
  - Upload command is shopify theme push --unpublished --json.
    theme share --json is used only when push --unpublished is unavailable.
  - Never runs shopify theme publish, never passes --live, and never uses shopify theme dev.
  - preview_url is always https://{store}/?preview_theme_id={id}.
  - Push timeout is 3.5 minutes (capped at 4). Timeout or upload failure attaches the Demo Theme.
  - Does not publish products or change channel status.
  - Never persists accessUrl, admin tokens, or the storefront password.
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

function demoManifestPath(opts) {
  return path.resolve(opts["demo-manifest"] || defaultDemoManifestPath());
}

function pushFixturePath(opts) {
  return path.resolve(opts["fixtures-dir"] || path.dirname(defaultPushFixturePath()), "theme-push.unpublished.success.json");
}

function skeletonDir(opts) {
  return path.resolve(opts.skeleton || defaultSkeletonDir());
}

async function loadBrandBrief(groupDir) {
  const briefPath = path.join(groupDir, "brand-brief.json");
  if (!(await pathExists(briefPath))) {
    throw new Error(
      `Brand brief not found at ${briefPath}. Run brand-intake apply --confirm first; shopify-theme-builder only fills a skeleton from brand-brief.json.`,
    );
  }
  return readJsonFile(briefPath);
}

async function readProductSummary(groupDir) {
  const resultPath = path.join(groupDir, "products.import.result.json");
  if (!(await pathExists(resultPath))) {
    return {
      available: false,
      imported_ok: null,
      note: "No product import summary. Theme fill does not publish products or change channel status.",
    };
  }
  const json = await readJsonFile(resultPath);
  const results = Array.isArray(json.results) ? json.results : [];
  return {
    available: true,
    imported_ok: results.filter((entry) => entry && entry.ok && entry.product_id).length,
    note: "Theme fill does not publish products or change channel status.",
  };
}

async function writeSafeJson(filePath, value, accessUrlForGuard) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertNoRawAccessUrl(serialized, accessUrlForGuard);
  assertArtifactSafe(serialized);
  await writePrivateJson(filePath, value);
  return serialized;
}

function continuationCommands(groupId) {
  const id = shellQuote(groupId);
  return [
    {
      id: "push_unpublished",
      label: "确认并 push Unpublished Theme",
      command: `./scripts/shopify-theme-builder.sh apply --group-id ${id} --confirm`,
    },
    {
      id: "dry_run",
      label: "离线演练（fixture manifest）",
      command: `./scripts/shopify-theme-builder.sh apply --group-id ${id} --confirm --dry-run`,
    },
    {
      id: "demo_theme",
      label: "改用 Demo Theme 预览",
      command: `./scripts/shopify-theme-builder.sh apply --group-id ${id} --confirm --demo`,
    },
  ];
}

async function runPlan(opts) {
  const groupDir = resolveGroupDir(opts);
  const connection = await readThemeConnection(groupDir);
  const brief = await loadBrandBrief(groupDir);
  const summary = summarizeFill(brief);
  const products = await readProductSummary(groupDir);
  const groupId = groupIdFrom(opts, groupDir);
  const demo = Boolean(opts.demo);
  const plan = {
    ok: true,
    artifact: PLAN_FILENAME,
    schema_version: "1.0",
    command: "plan",
    group_id: groupId,
    store: connection.store,
    store_type: "preview",
    dry_run: Boolean(opts["dry-run"]),
    demo,
    shopify_called: false,
    writes_manifest: false,
    theme_publish_invoked: false,
    products_touched: false,
    channel_status_changed: false,
    planned_command: demo ? null : "shopify theme push --unpublished --json",
    pages: [...PAGES],
    fill: publicFill(summary),
    sections: summary.sections,
    risks: summary.risks,
    products,
    participant_confirm_copy: CONFIRM_COPY,
    continuations: continuationCommands(groupId),
    preview_url_shape: `https://${connection.store}/?preview_theme_id={id}`,
  };

  await ensureWorkshopGitignore(groupDir);
  const artifactPath = path.join(groupDir, PLAN_FILENAME);
  await writeSafeJson(artifactPath, plan, connection.accessUrlForGuard);
  return {
    ...plan,
    artifacts: {
      plan_json: relativeArtifactPath(artifactPath),
    },
    next: "Review the fill summary and risks with a human, then run apply --confirm. Use --dry-run for a fixture manifest or --demo to attach the documented Demo Theme.",
  };
}

async function runApply(opts) {
  if (!opts.confirm) {
    throw new Error(
      "Refusing to apply without --confirm. Review theme.plan.json and obtain human confirmation outside the CLI.",
    );
  }

  const groupDir = resolveGroupDir(opts);
  const connection = await readThemeConnection(groupDir);
  const brief = await loadBrandBrief(groupDir);
  const dryRun = Boolean(opts["dry-run"]);
  const demo = Boolean(opts.demo);
  const mode = demo ? "demo" : dryRun ? "dry-run" : "push";
  const workDir = path.join(groupDir, THEME_WORK_DIRNAME);

  let fill = null;
  if (mode === "demo") {
    fill = summarizeFill(brief);
  } else {
    fill = await fillSkeleton({
      brief,
      skeletonDir: skeletonDir(opts),
      destDir: workDir,
      accessUrlForGuard: connection.accessUrlForGuard,
    });
  }

  const demoId = parseDemoThemeId(process.env.SHOPWRIGHT_DEMO_THEME_ID);
  const resolved = await resolveThemeUpload({
    mode,
    loadDemo: (reason) => loadDemoManifest({
      store: connection.store,
      manifestPath: demoManifestPath(opts),
      themeIdOverride: demoId,
      reason,
    }),
    loadFixture: () => loadDryRunManifest({
      store: connection.store,
      fixturePath: pushFixturePath(opts),
      fill,
    }),
    push: async () => {
      const uploaded = await pushUnpublishedTheme({
        store: connection.store,
        themePath: workDir,
      });
      return buildManifest({
        themeId: uploaded.theme_id,
        status: "unpublished",
        store: connection.store,
        fallbackUsed: false,
        fill,
        extra: {
          dry_run: false,
          fake: false,
          demo: false,
          shopify_called: true,
          upload_strategy: uploaded.upload_strategy,
          planned_command: uploaded.upload_strategy === "share"
            ? "shopify theme share --json"
            : "shopify theme push --unpublished --json",
          theme_name: uploaded.name || fill.theme_name,
          role: "unpublished",
          fallback_reason: null,
        },
      });
    },
  });

  const manifest = resolved.manifest;
  if (!manifest.fallback_used) manifest.fill = publicFill(fill);
  manifest.dry_run = dryRun;

  await ensureWorkshopGitignore(groupDir);
  const manifestPath = path.join(groupDir, MANIFEST_FILENAME);
  await writeSafeJson(manifestPath, manifest, connection.accessUrlForGuard);

  const statePath = path.join(groupDir, "workshop-state.yaml");
  const existingState = await readTextOrEmpty(statePath);
  const nextState = updateThemeState(existingState, {
    themeId: manifest.theme_id,
    status: manifest.status,
    previewUrl: manifest.preview_url,
    fallbackUsed: manifest.fallback_used,
  });
  assertNoRawAccessUrl(nextState, connection.accessUrlForGuard);
  await writePrivateText(statePath, nextState);

  const output = {
    ok: true,
    command: "apply",
    dry_run: dryRun,
    demo: Boolean(manifest.demo),
    store: connection.store,
    store_type: "preview",
    theme_id: manifest.theme_id,
    status: manifest.status,
    preview_url: manifest.preview_url,
    fallback_used: manifest.fallback_used,
    fallback_reason: manifest.fallback_reason || null,
    pages: manifest.pages,
    shopify_called: resolved.shopify_called,
    upload_strategy: manifest.upload_strategy || null,
    theme_publish_invoked: false,
    products_touched: false,
    channel_status_changed: false,
    live_theme_touched: false,
    state_updated: true,
    fill: publicFill(fill),
    artifacts: {
      theme_manifest_json: relativeArtifactPath(manifestPath),
      workshop_state_yaml: relativeArtifactPath(statePath),
      ...(mode === "demo" ? {} : { theme_work: relativeArtifactPath(workDir) }),
    },
  };
  if (manifest.fixture) output.fixture_used = manifest.fixture;
  return output;
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.version) {
    process.stdout.write(`${JSON.stringify({ runtime: "shopify-theme-builder", version: "0.1.0" })}\n`);
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
            "Run plan --group-id <id> and review the fill summary with a human.",
            "Use apply --confirm to upload an unpublished theme, or apply --confirm --dry-run for a fixture manifest.",
            "Use apply --confirm --demo to attach the documented Demo Theme. The live theme is never changed.",
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
