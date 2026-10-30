#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractJson } from "./json.js";
import {
  buildConnectionArtifact,
  buildVerificationResult,
  parseCreateStoreResult,
  parseStoreInfoResult,
  REQUIRED_SCOPES,
  STOREFRONT_SESSION_HANDLE,
} from "./store.js";
import {
  ensureWorkshopGitignore,
  readConnection,
  readJsonFile,
  readTextOrEmpty,
  relativeArtifactPath,
  updateWorkshopStateYaml,
  writeConnectionJson,
  writePrivateFile,
} from "./files.js";
import { redactSensitiveText } from "./redact.js";
import {
  createPreviewStore,
  getShopifyBin,
  getStoreInfo,
  openStoreSession,
  ShopifyCliError,
} from "./shopify-cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

const BOOLEAN_FLAGS = new Set([
  "help",
  "dry-run",
  "json",
  "version",
]);

const VALUE_FLAGS = new Set([
  "group-id",
  "group-dir",
  "workdir",
  "name",
  "mode",
  "country",
  "store",
  "fixtures-dir",
  "fixture-create",
  "fixture-info",
]);

function usage() {
  return `ShopWright Workshop — Shopify Preview Store connect runtime

Usage:
  node src/cli.js create   --group-id <id> --name <display name> [--mode demo|hands_on] [--dry-run]
  node src/cli.js info     (--group-id <id> | --store <domain.myshopify.com>) [--dry-run]
  node src/cli.js verify   (--group-id <id> | --store <domain.myshopify.com>) [--dry-run]
  node src/cli.js connect  --group-id <id> --name <display name> [--mode demo|hands_on] [--dry-run]
  node src/cli.js run      ... same as connect
  node src/cli.js open     (--group-id <id> | --store <domain.myshopify.com>) [--dry-run]

Options:
  --workdir <dir>       Parent runtime workspace (default: .workshop)
  --group-dir <dir>     Explicit group workdir (overrides --workdir/--group-id path)
  --country <CC>        Optional ISO country code for store creation
  --fixtures-dir <dir>  Fixture directory for --dry-run
  --json                Accepted for agent compatibility; output is JSON by default
  --help                Show this help

Safety:
  - Human confirmation happens outside this CLI; no command asks for confirmation.
  - info intentionally returns access_url on stdout only. Do not redirect it to a file.
  - Only connection.json and workshop-state.yaml are written under the group workdir.
  - No Dev Store fallback, OAuth flow, storefront password, theme, Excel, or GEO operations.
`;
}

function parseArgs(argv) {
  if (argv.length === 0) return { command: "help", opts: {} };
  const command = argv[0];
  const opts = {};
  const positional = [];

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
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
      i += 1;
      value = argv[i];
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${key} requires a value`);
    }
    opts[key] = value;
  }

  if (positional.length > 0) {
    throw new Error(`Unexpected argument(s): ${positional.join(" ")}`);
  }
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
  const groupId = validateGroupId(opts["group-id"]);
  return path.resolve(opts.workdir || ".workshop", groupId);
}

function connectionPath(groupDir) {
  return path.join(groupDir, "connection.json");
}

function workshopStatePath(groupDir) {
  return path.join(groupDir, "workshop-state.yaml");
}

function fixturePath(opts, specificFlag, filename) {
  if (opts[specificFlag]) return path.resolve(opts[specificFlag]);
  return path.resolve(opts["fixtures-dir"] || DEFAULT_FIXTURES_DIR, filename);
}

async function runCreate(opts) {
  const groupId = validateGroupId(opts["group-id"]);
  const name = requireString(opts.name, "--name");
  const groupDir = resolveGroupDir(opts);
  const mode = opts.mode || "demo";
  if (!["demo", "hands_on"].includes(mode)) throw new Error("--mode must be demo or hands_on");

  const created = opts["dry-run"]
    ? {
        payload: JSON.stringify(await readJsonFile(fixturePath(opts, "fixture-create", "create-preview.success.json"))),
        command: "dry-run fixture: create-preview.success.json",
      }
    : await createPreviewStore({ name, country: opts.country });

  let parsed;
  try {
    parsed = parseCreateStoreResult(extractJson(created.payload));
  } catch (error) {
    throw new ShopifyCliError(`Could not parse Preview Store creation output: ${error.message}`, {
      command: created.command,
      hints: [
        "Retry the create command once, then try a different display store name.",
        `Confirm the CLI version and --json support: ${getShopifyBin()} version.`,
        "Check network/proxy access and CLI sign-in. Do not switch to a Dev Store.",
      ],
    });
  }

  const connection = buildConnectionArtifact({
    domain: parsed.domain,
    storeName: parsed.storeName || name,
    scopes: parsed.scopes,
    passwordProtectionEnabled: parsed.passwordProtectionEnabled,
    productCount: 0,
  });

  await ensureWorkshopGitignore(groupDir);
  await writeConnectionJson(connectionPath(groupDir), connection, parsed.accessUrl);

  return {
    ok: true,
    dry_run: Boolean(opts["dry-run"]),
    connection,
    artifacts: {
      connection_json: relativeArtifactPath(connectionPath(groupDir)),
    },
    next: "Run info to return the ephemeral access_url to the caller, then verify scopes.",
  };
}

async function loadInfo(opts, { domainFromConnection = false } = {}) {
  let domain = opts.store;
  if (!domain) {
    if (!domainFromConnection) throw new Error("--store or --group-id is required");
    const groupDir = resolveGroupDir(opts);
    const connection = await readConnection(connectionPath(groupDir));
    domain = connection.store;
  }

  if (opts["dry-run"]) {
    const payload = await readJsonFile(fixturePath(opts, "fixture-info", "store-info.success.json"));
    return parseStoreInfoResult(payload);
  }

  const result = await getStoreInfo(domain);
  try {
    return parseStoreInfoResult(extractJson(result.payload));
  } catch (error) {
    throw new ShopifyCliError(`Could not parse Shopify store info output: ${error.message}`, {
      command: result.command,
      hints: [
        "Retry store info once.",
        `Check CLI version and sign-in: ${getShopifyBin()} version; ${getShopifyBin()} auth login.`,
        "Confirm the store is a Preview Store and that the CLI session has not expired.",
      ],
    });
  }
}

async function runInfo(opts) {
  const info = await loadInfo(opts, { domainFromConnection: true });
  const verification = buildVerificationResult(info);
  const result = {
    ok: true,
    dry_run: Boolean(opts["dry-run"]),
    store: info.domain,
    store_name: info.storeName,
    store_type: info.storeType,
    auth: "cli_cached_admin_token",
    scopes_ok: verification.scopes_ok,
    scopes_include: verification.scopes_include,
    missing_scopes: verification.missing_scopes,
    storefront_session: STOREFRONT_SESSION_HANDLE,
    access_url: info.accessUrl,
    access_url_notice: "Sensitive session credential. Return to the caller in memory; never redirect or persist this URL.",
  };
  if (typeof info.passwordProtectionEnabled === "boolean") {
    result.password_protection_enabled = info.passwordProtectionEnabled;
  }
  return result;
}

async function runVerify(opts) {
  const info = await loadInfo(opts, { domainFromConnection: true });
  const result = {
    ok: buildVerificationResult(info).scopes_ok,
    dry_run: Boolean(opts["dry-run"]),
    ...buildVerificationResult(info),
  };
  if (!result.ok) {
    result.hints = [
      "Retry store info once to refresh the CLI-cached Admin token scopes.",
      `Confirm CLI sign-in: ${getShopifyBin()} auth login.`,
      "If required scopes are still missing, pause this group and ask the facilitator. Do not use a Dev Store or paste a Custom App token.",
    ];
  }
  return result;
}

async function runConnect(opts) {
  const groupId = validateGroupId(opts["group-id"]);
  const name = requireString(opts.name, "--name");
  const groupDir = resolveGroupDir(opts);
  const mode = opts.mode || "demo";
  if (!["demo", "hands_on"].includes(mode)) throw new Error("--mode must be demo or hands_on");

  const created = opts["dry-run"]
    ? {
        payload: JSON.stringify(await readJsonFile(fixturePath(opts, "fixture-create", "create-preview.success.json"))),
        command: "dry-run fixture: create-preview.success.json",
      }
    : await createPreviewStore({ name, country: opts.country });

  let createdStore;
  try {
    createdStore = parseCreateStoreResult(extractJson(created.payload));
  } catch (error) {
    throw new ShopifyCliError(`Could not parse Preview Store creation output: ${error.message}`, {
      command: created.command,
      hints: [
        "Retry the same create command once; if it still fails, try a different display store name.",
        `Check the Shopify CLI version, --json support, sign-in, and network: ${getShopifyBin()} version.`,
        "Do not fall back to a Dev Store or any other store path.",
      ],
    });
  }

  const info = opts["dry-run"]
    ? parseStoreInfoResult(await readJsonFile(fixturePath(opts, "fixture-info", "store-info.success.json")))
    : await (async () => {
        const result = await getStoreInfo(createdStore.domain);
        try {
          return parseStoreInfoResult(extractJson(result.payload));
        } catch (error) {
          throw new ShopifyCliError(`Could not parse Shopify store info output: ${error.message}`, {
            command: result.command,
            hints: [
              "Retry store info once.",
              `Check CLI sign-in and network: ${getShopifyBin()} auth login.`,
              "If accessUrl or authScopes are missing, pause this group and ask the facilitator.",
            ],
          });
        }
      })();

  if (info.domain !== createdStore.domain) {
    throw new ShopifyCliError(
      `Store info returned ${info.domain}, which does not match the created Preview Store ${createdStore.domain}`,
      {
        hints: [
          "Re-run store info against the recorded domain.",
          "Do not connect a different or production store. Ask the facilitator if the domain keeps changing.",
        ],
      },
    );
  }

  // Prefer the scopes reported by store info. If a CLI version omits them,
  // fall back to the scopes from the create result rather than inventing any.
  const scopes = info.scopes.length > 0 ? info.scopes : createdStore.scopes;
  const verification = buildVerificationResult({ ...info, scopes });
  const connection = buildConnectionArtifact({
    domain: info.domain,
    storeName: info.storeName || name,
    scopes,
    passwordProtectionEnabled:
      typeof info.passwordProtectionEnabled === "boolean"
        ? info.passwordProtectionEnabled
        : createdStore.passwordProtectionEnabled,
    productCount: 0,
  });

  await ensureWorkshopGitignore(groupDir);
  await writeConnectionJson(connectionPath(groupDir), connection, info.accessUrl);

  const statePath = workshopStatePath(groupDir);
  const existingState = await readTextOrEmpty(statePath);
  const nextState = updateWorkshopStateYaml(existingState, {
    groupId,
    storeDomain: info.domain,
    mode,
    status: verification.scopes_ok ? "connected" : "failed",
    scopesOk: verification.scopes_ok,
  });
  if (info.accessUrl && nextState.includes(info.accessUrl)) {
    throw new Error("Refusing to write workshop-state.yaml containing the raw accessUrl");
  }
  await writePrivateFile(statePath, nextState);

  const artifacts = {
    connection_json: relativeArtifactPath(connectionPath(groupDir)),
    workshop_state_yaml: relativeArtifactPath(statePath),
  };

  if (!verification.scopes_ok) {
    const error = new ShopifyCliError(
      `Required Admin API scopes are missing: ${verification.missing_scopes.join(", ")}`,
      {
        hints: [
          "Retry store info once to refresh the CLI-cached Admin token scopes.",
          `Confirm CLI sign-in: ${getShopifyBin()} auth login.`,
          "If scopes remain missing, pause this group and ask the facilitator. Do not use a Dev Store or Custom App token paste flow.",
        ],
      },
    );
    error.artifacts = artifacts;
    throw error;
  }

  return {
    ok: true,
    dry_run: Boolean(opts["dry-run"]),
    connection,
    artifacts,
  };
}

async function runOpen(opts) {
  let domain = opts.store;
  if (!domain) {
    const groupDir = resolveGroupDir(opts);
    const connection = await readConnection(connectionPath(groupDir));
    domain = connection.store;
  }

  const command = `${getShopifyBin()} store open --store ${domain}`;
  if (opts["dry-run"]) {
    return {
      ok: true,
      dry_run: true,
      store: domain,
      opened: false,
      command,
      guidance: "Interactive browser opening is skipped in dry-run. Run the command above when a browser is available.",
    };
  }

  try {
    const result = await openStoreSession(domain);
    const payload = extractJson(result.payload);
    return {
      ok: true,
      store: domain,
      opened: Boolean(payload.opened),
      command,
      guidance: payload.opened
        ? "Browser open requested. Return to the participant without persisting any returned URL."
        : `No browser was opened. Run manually when a browser is available: ${command}`,
    };
  } catch (error) {
    return {
      ok: true,
      store: domain,
      opened: false,
      command,
      warning: redactSensitiveText(error.message),
      guidance: `Interactive browser opening was unavailable. Run manually when a browser is available: ${command}`,
    };
  }
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.version) {
    process.stdout.write(`${JSON.stringify({ runtime: "shopify-store-connect", version: "0.1.0" })}\n`);
    return;
  }
  if (command === "help" || command === "--help" || opts.help) {
    process.stdout.write(usage());
    return;
  }

  let result;
  switch (command) {
    case "create":
      result = await runCreate(opts);
      break;
    case "info":
      result = await runInfo(opts);
      break;
    case "verify":
      result = await runVerify(opts);
      if (!result.ok) process.exitCode = 2;
      break;
    case "connect":
    case "run":
      result = await runConnect(opts);
      break;
    case "open":
      result = await runOpen(opts);
      break;
    default:
      throw new Error(`Unknown command "${command}". Run with --help for usage.`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const payload = {
    ok: false,
    error: redactSensitiveText(error.message),
  };
  if (error.command) payload.command = error.command;
  if (Array.isArray(error.hints) && error.hints.length > 0) payload.hints = error.hints;
  if (error.artifacts) payload.artifacts = error.artifacts;
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = typeof error.exitCode === "number" ? error.exitCode : 1;
});
