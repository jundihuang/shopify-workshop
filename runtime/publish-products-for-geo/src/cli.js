#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPublishConnection } from "./connection.js";
import {
  ensureWorkshopGitignore,
  readTextOrEmpty,
  relativeArtifactPath,
  writePrivateJson,
  writePrivateText,
} from "./files.js";
import {
  buildPlanObject,
  loadPlanProducts,
  parseProductIdList,
  planArtifactPath,
} from "./plan.js";
import { channelResultPath, publishProducts } from "./publish.js";
import { assertArtifactSafe, redactSensitiveText } from "./redact.js";
import { executeShopifyGraphQL } from "./shopify.js";
import { updateProductsChannelStatus } from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

const BOOLEAN_FLAGS = new Set(["help", "version", "json", "dry-run", "confirm"]);
const VALUE_FLAGS = new Set([
  "group-id",
  "group-dir",
  "workdir",
  "product-id",
  "fixtures-dir",
]);

function usage() {
  return `ShopWright Workshop — publish products for GEO runtime

Usage:
  node src/cli.js plan  (--group-id <id> | --group-dir <dir>) [--product-id <id> ...] [--dry-run]
  node src/cli.js apply (--group-id <id> | --group-dir <dir>) --confirm [--product-id <id> ...] [--dry-run]

Options:
  --group-id <id>        Workshop group id; artifacts live under .workshop/<id>/
  --group-dir <dir>      Explicit group directory override
  --workdir <dir>        Parent workshop workspace (default: .workshop)
  --product-id <id>      Explicit product id (repeatable or comma-separated). When present,
                         only these products are planned; otherwise the group import result is used.
  --confirm              Required for apply, including --dry-run. Human confirmation happens
                         outside this CLI after reviewing the plan.
  --dry-run              Never call Shopify. Writes a fixture-backed channel result.
  --fixtures-dir <dir>   Fixture directory for --dry-run
  --json                 Accepted for agent compatibility; output is JSON by default
  --help                 Show this help

Artifacts:
  .workshop/<group-id>/products.channel.plan.json
  .workshop/<group-id>/products.channel.json
  .workshop/<group-id>/workshop-state.yaml   # products.channel_status

Safety:
  - Refuses any connection.store_type other than preview.
  - Requires write_products and write_publications scopes.
  - Never publishes, pushes, or edits a theme; the theme stays unpublished.
  - Never reads or writes the storefront password or accessUrl.
  - Publishes only group import-result products or an explicit --product-id list.
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
    if (key === "product-id") {
      if (!Array.isArray(opts[key])) opts[key] = [];
      opts[key].push(value);
    } else {
      opts[key] = value;
    }
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

async function writeSafeJson(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertArtifactSafe(serialized);
  await writePrivateJson(filePath, value);
  return serialized;
}

async function makePlan(opts, groupDir, connection) {
  const productIds = parseProductIdList(opts["product-id"] || []);
  const loaded = await loadPlanProducts({
    groupDir,
    productIds,
    dryRun: Boolean(opts["dry-run"]),
    executeGraphql: executeShopifyGraphQL,
    fixturesDir: path.resolve(opts["fixtures-dir"] || DEFAULT_FIXTURES_DIR),
    domain: connection.store,
  });
  return {
    ...buildPlanObject({
      connection,
      products: loaded.products,
      source: loaded.source,
      sourceArtifact: loaded.source_artifact ? relativeArtifactPath(loaded.source_artifact) : null,
      dryRun: Boolean(opts["dry-run"]),
    }),
    ok: true,
  };
}

async function runPlan(opts) {
  const groupDir = resolveGroupDir(opts);
  const connection = await readPublishConnection(groupDir);
  const plan = await makePlan(opts, groupDir, connection);
  await ensureWorkshopGitignore(groupDir);
  const artifactPath = planArtifactPath(groupDir);
  await writeSafeJson(artifactPath, plan);

  return {
    ...plan,
    artifacts: {
      plan_json: relativeArtifactPath(artifactPath),
    },
    next: "Review the plan and participant_confirm_copy with a human, then run apply --confirm.",
  };
}

async function runApply(opts) {
  const groupDir = resolveGroupDir(opts);
  // Check confirmation before reading the connection or issuing even read-only
  // Admin queries. apply is the mutating command and always requires --confirm.
  if (!opts.confirm) {
    throw new Error(
      "Refusing to apply without --confirm. Review products.channel.plan.json and obtain human confirmation outside the CLI.",
    );
  }

  const connection = await readPublishConnection(groupDir);
  const plan = await makePlan(opts, groupDir, connection);
  const dryRun = Boolean(opts["dry-run"]);
  const result = await publishProducts({
    plan,
    connection,
    dryRun,
    executeGraphql: executeShopifyGraphQL,
    fixturesDir: path.resolve(opts["fixtures-dir"] || DEFAULT_FIXTURES_DIR),
  });

  await ensureWorkshopGitignore(groupDir);
  const artifactPath = channelResultPath(groupDir);
  await writeSafeJson(artifactPath, result);

  const artifacts = {
    channel_json: relativeArtifactPath(artifactPath),
  };
  let stateUpdated = false;
  if (result.summary.failed === 0 && result.summary.planned > 0) {
    const statePath = path.join(groupDir, "workshop-state.yaml");
    const existingState = await readTextOrEmpty(statePath);
    const nextState = updateProductsChannelStatus(existingState, {
      channelStatus: "online_store_active",
    });
    assertArtifactSafe(nextState);
    await writePrivateText(statePath, nextState);
    artifacts.workshop_state_yaml = relativeArtifactPath(statePath);
    stateUpdated = true;
  }

  const output = {
    ok: result.summary.failed === 0 && result.summary.planned > 0,
    command: "apply",
    dry_run: dryRun,
    store: connection.store,
    store_type: "preview",
    shopify_status: result.shopify_status,
    channel_publish: result.channel_publish,
    channels_published: result.channels_published,
    theme: result.theme,
    target_publication: result.target_publication,
    summary: result.summary,
    state_updated: stateUpdated,
    products: result.products,
    artifacts,
  };
  if (dryRun) output.fixture_used = "fixtures/channel-publish.success.json";
  return output;
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.version) {
    process.stdout.write(`${JSON.stringify({ runtime: "publish-products-for-geo", version: "0.1.0" })}\n`);
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

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        error: redactSensitiveText(error.message),
        hints: [
          "Run plan first and review products.channel.plan.json with a human.",
          "Use apply --confirm for a real run or apply --dry-run --confirm for fixture-backed artifacts.",
          "Only Preview Stores with write_products and write_publications are accepted; themes are never published.",
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
});
