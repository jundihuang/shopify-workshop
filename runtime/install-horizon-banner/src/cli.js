#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBannerConnection } from "./connection.js";
import {
  DEFAULT_BANNER_IMAGE_URL,
  DEFAULT_HERO_BUTTON_LABEL,
  DEFAULT_HERO_HEADING,
  PARTICIPANT_CONFIRM_COPY,
  installBanner,
  loadHorizonContext,
  restoreBanner,
} from "./core.js";
import {
  ensureWorkshopGitignore,
  pathExists,
  readTextOrEmpty,
  relativeArtifactPath,
  writePrivateJson,
  writePrivateText,
} from "./files.js";
import { assertArtifactSafe, redactSensitiveText } from "./redact.js";
import { executeBannerGraphQL } from "./shopify.js";
import { findHeroSection, heroBannerState, heroCopyState, parseTemplateJson } from "./theme.js";
import { updateBannerState } from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

const BOOLEAN_FLAGS = new Set(["help", "version", "json", "dry-run", "confirm"]);
const VALUE_FLAGS = new Set(["group-id", "group-dir", "workdir", "image-url", "image-file", "heading", "button-label", "fixtures-dir"]);

const PLAN_ARTIFACT = "banner.plan.json";
const RESULT_ARTIFACT = "banner.install.json";
const BACKUP_ARTIFACT = "horizon-index.backup.json";

function usage() {
  return `ShopWright Workshop — install Horizon banner runtime (Step 9)

Installs the workshop banner image onto the Horizon MAIN (live) theme homepage
hero so the storefront preview link shows the banner immediately. This is the
approved Preview Store showcase exception: only templates/index.json is edited,
the original is backed up first, and it can be restored with one command.

Usage:
  node src/cli.js plan    (--group-id <id> | --group-dir <dir>) [--dry-run]
  node src/cli.js apply   (--group-id <id> | --group-dir <dir>) --confirm [--dry-run] [--image-url <url>]
  node src/cli.js restore (--group-id <id> | --group-dir <dir>) --confirm [--dry-run]

Options:
  --group-id <id>      Workshop group id; artifacts live under .workshop/<id>/
  --group-dir <dir>    Explicit group directory override
  --workdir <dir>      Parent workshop workspace (default: .workshop)
  --image-url <url>    Public https image URL to upload (default: the bundled
                       workshop banner photo, 2400x1200 crop)
  --image-file <path>  Local image file to upload (jpg/png/webp/gif/avif).
                       Takes precedence over --image-url. Use this when a
                       merchant sends a photo directly in the chat.
  --heading <text>     Hero heading copy (default: "Heavyweight tees, broken in
                       from day one."). Pass "" to leave the current copy.
  --button-label <txt> Hero button label (default: "Shop the collection").
                       Pass "" to leave the current label.
  --confirm            Required for apply and restore, including --dry-run.
  --dry-run            Never call Shopify. Uses the fixture homepage template.
  --fixtures-dir <dir> Fixture directory for --dry-run
  --json               Accepted for agent compatibility; output is JSON by default
  --help               Show this help

Artifacts:
  .workshop/<group-id>/banner.plan.json
  .workshop/<group-id>/banner.install.json
  .workshop/<group-id>/horizon-index.backup.json
  .workshop/<group-id>/workshop-state.yaml   # banner section

Safety:
  - Refuses any connection.store_type other than preview.
  - Requires the write_themes scope.
  - Edits exactly one live-theme file (templates/index.json) after backing it up.
  - Never publishes a theme, never touches products, never reads or writes the
    storefront password or accessUrl.
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

function validateGroupId(groupId) {
  const value = String(groupId ?? "").trim();
  if (!value) throw new Error("--group-id is required");
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

async function writeSafeJson(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertArtifactSafe(serialized);
  await writePrivateJson(filePath, value);
  return serialized;
}

async function bannerPlan(opts) {
  const groupDir = resolveGroupDir(opts);
  const connection = await readBannerConnection(groupDir);
  const dryRun = Boolean(opts["dry-run"]);
  const context = await loadHorizonContext({
    connection,
    dryRun,
    fixturesDir: path.resolve(opts["fixtures-dir"] || DEFAULT_FIXTURES_DIR),
  });
  const indexObject = parseTemplateJson(context.template_text);
  const { key: heroKey } = findHeroSection(indexObject);
  const current = heroBannerState(indexObject, heroKey);

  const plan = {
    ok: true,
    schema_version: "1.0",
    artifact: PLAN_ARTIFACT,
    command: "plan",
    group_id: opts["group-id"] ?? null,
    store: connection.store,
    store_type: "preview",
    dry_run: dryRun,
    shopify_called: false,
    writes_template: false,
    theme: { id: context.theme.id, name: context.theme.name, role: context.theme.role },
    homepage_template: "templates/index.json",
    hero_section: heroKey,
    image_1_current: current,
    image_url: opts["image-url"] || DEFAULT_BANNER_IMAGE_URL,
    copy_current: heroCopyState(indexObject, heroKey),
    heading: "heading" in opts ? opts.heading : DEFAULT_HERO_HEADING,
    button_label: "button-label" in opts ? opts["button-label"] : DEFAULT_HERO_BUTTON_LABEL,
    backup_file: BACKUP_ARTIFACT,
    participant_confirm_copy: PARTICIPANT_CONFIRM_COPY,
    risks: [
      "This step edits the Horizon MAIN (live) theme homepage template on the Preview Store (approved showcase exception).",
      "Only templates/index.json is modified; the original is written to horizon-index.backup.json first.",
      "Restore anytime with: ./scripts/install-horizon-banner.sh restore --group-id <id> --confirm",
    ],
    next: "Review the plan and participant_confirm_copy with a human, then run apply --confirm.",
  };
  await ensureWorkshopGitignore(groupDir);
  const planPath = path.join(groupDir, PLAN_ARTIFACT);
  await writeSafeJson(planPath, plan);
  return { ...plan, artifacts: { plan_json: relativeArtifactPath(planPath) } };
}

async function bannerApply(opts) {
  const groupDir = resolveGroupDir(opts);
  if (!opts.confirm) {
    throw new Error(
      `Refusing to apply without --confirm. Review ${PLAN_ARTIFACT} and obtain human confirmation outside the CLI.`,
    );
  }
  const connection = await readBannerConnection(groupDir);
  const dryRun = Boolean(opts["dry-run"]);
  const fixturesDir = path.resolve(opts["fixtures-dir"] || DEFAULT_FIXTURES_DIR);

  const backupPath = path.join(groupDir, BACKUP_ARTIFACT);
  const resultPath = path.join(groupDir, RESULT_ARTIFACT);
  const result = await installBanner({
    connection: { ...connection, groupId: opts["group-id"] ?? null },
    groupDir,
    imageUrl: opts["image-url"] || DEFAULT_BANNER_IMAGE_URL,
    imageFile: opts["image-file"] || null,
    heading: "heading" in opts ? opts.heading : DEFAULT_HERO_HEADING,
    buttonLabel: "button-label" in opts ? opts["button-label"] : DEFAULT_HERO_BUTTON_LABEL,
    dryRun,
    fixturesDir,
    writeBackup: async (templateText) => {
      assertArtifactSafe(templateText);
      await writePrivateText(backupPath, templateText.endsWith("\n") ? templateText : `${templateText}\n`);
      return BACKUP_ARTIFACT;
    },
    writeResult: async (value) => {
      await writeSafeJson(resultPath, value);
    },
  });

  await ensureWorkshopGitignore(groupDir);
  const statePath = path.join(groupDir, "workshop-state.yaml");
  const existingState = await readTextOrEmpty(statePath);
  const nextState = updateBannerState(existingState, {
    status: "done",
    themeId: dryRun ? null : Number(String(result.theme.id).split("/").pop()) || null,
    imageRef: result.image_ref,
    backupFile: BACKUP_ARTIFACT,
  });
  assertArtifactSafe(nextState);
  await writePrivateText(statePath, nextState);

  return {
    ...result,
    artifacts: {
      banner_install_json: relativeArtifactPath(resultPath),
      backup: relativeArtifactPath(backupPath),
      workshop_state_yaml: relativeArtifactPath(statePath),
    },
    state_updated: true,
  };
}

async function bannerRestore(opts) {
  const groupDir = resolveGroupDir(opts);
  if (!opts.confirm) {
    throw new Error("Refusing to restore without --confirm.");
  }
  const connection = await readBannerConnection(groupDir);
  const dryRun = Boolean(opts["dry-run"]);
  const backupPath = path.join(groupDir, BACKUP_ARTIFACT);
  if (!(await pathExists(backupPath))) {
    throw new Error(`No backup found at ${backupPath}. Nothing to restore.`);
  }

  const restored = await restoreBanner({
    connection,
    dryRun,
    runGraphql: executeBannerGraphQL,
    readBackup: async () => {
      const text = await readTextOrEmpty(backupPath);
      if (!text.trim()) throw new Error(`Backup at ${backupPath} is empty.`);
      assertArtifactSafe(text);
      return text;
    },
  });

  const statePath = path.join(groupDir, "workshop-state.yaml");
  const existingState = await readTextOrEmpty(statePath);
  const nextState = updateBannerState(existingState, { status: "restored" });
  assertArtifactSafe(nextState);
  await writePrivateText(statePath, nextState);

  return { ...restored, command: "restore", state_updated: true };
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.version) {
    process.stdout.write(`${JSON.stringify({ runtime: "install-horizon-banner", version: "0.1.0" })}\n`);
    return;
  }
  if (command === "help" || command === "--help" || opts.help) {
    process.stdout.write(usage());
    return;
  }

  let output;
  switch (command) {
    case "plan":
      output = await bannerPlan(opts);
      break;
    case "apply":
      output = await bannerApply(opts);
      break;
    case "restore":
      output = await bannerRestore(opts);
      break;
    default:
      throw new Error(`Unknown command "${command}". Run with --help for usage.`);
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.ok === false) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        error: redactSensitiveText(error.message),
        hints: [
          "Run plan first and review banner.plan.json with a human.",
          "Use apply --confirm for the real install, or apply --confirm --dry-run for the fixture flow.",
          "Only Preview Stores with write_themes are accepted; only templates/index.json is touched and it is backed up first.",
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
});
