import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redactSensitiveText } from "./redact.js";

const execFileAsync = promisify(execFile);
const SHOPIFY_BIN = process.env.SHOPIFY_CLI_BIN || "shopify";
const DEFAULT_TIMEOUT_MS = Number(process.env.SHOPIFY_CLI_TIMEOUT_MS || 180_000);
const capabilityCache = new Map();
let versionPromise = null;

export class ShopifyCliError extends Error {
  constructor(message, { hints = [], command = null, exitCode = null } = {}) {
    super(redactSensitiveText(message));
    this.name = "ShopifyCliError";
    this.hints = hints;
    this.command = command;
    this.exitCode = exitCode;
  }
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatShopifyCommand(args) {
  return [SHOPIFY_BIN, ...args].map(shellQuote).join(" ");
}

function cliFailure(error, args, action) {
  const exitCode = typeof error.code === "number" ? error.code : null;
  const detail = redactSensitiveText(
    String(error.stderr || error.stdout || error.message || "Shopify CLI command failed").trim(),
  );
  return new ShopifyCliError(`${action} failed${exitCode === null ? "" : ` (exit ${exitCode})`}: ${detail}`, {
    command: formatShopifyCommand(args),
    exitCode,
    hints: [
      "Retry the same command once in case this was a transient network or CLI error.",
      "If creation failed, try a different display store name.",
      `Check that the Shopify CLI is installed and signed in: ${SHOPIFY_BIN} version; ${SHOPIFY_BIN} auth login.`,
      "Check classroom network/proxy access. Do not switch to a Dev Store and do not ask for an Opening soon password.",
    ],
  });
}

async function execShopify(args, action) {
  try {
    const { stdout, stderr } = await execFileAsync(SHOPIFY_BIN, args, {
      encoding: "utf8",
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, SHOPIFY_FLAG_NO_COLOR: "1" },
    });
    return { stdout, stderr };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ShopifyCliError(`Shopify CLI executable "${SHOPIFY_BIN}" was not found`, {
        command: formatShopifyCommand(args),
        hints: [
          "Install the Shopify CLI and sign in before running this Workshop step.",
          "Use --dry-run to exercise artifact writing locally without the Shopify CLI.",
        ],
      });
    }
    throw cliFailure(error, args, action);
  }
}

export async function getShopifyVersion() {
  if (!versionPromise) {
    versionPromise = execShopify(["version"], "Shopify CLI version check")
      .then(({ stdout, stderr }) => (stdout || stderr || "unknown").trim().split(/\r?\n/)[0])
      .catch(() => "unknown");
  }
  return versionPromise;
}

/**
 * Shopify CLI 5.x supports --json for store commands. We probe help output
 * instead of assuming a version number, then fail with an actionable message
 * when the installed CLI does not expose the flag. There is deliberately no
 * screen-scraping fallback: raw access URLs must stay in the JSON session path.
 */
export async function assertJsonCommandSupport(commandArgs) {
  const cacheKey = commandArgs.join(" ");
  if (capabilityCache.has(cacheKey)) return capabilityCache.get(cacheKey);

  const args = [...commandArgs, "--help"];
  let helpText;
  try {
    const { stdout, stderr } = await execShopify(args, "Shopify CLI compatibility check");
    helpText = `${stdout}\n${stderr}`;
  } catch (error) {
    if (error instanceof ShopifyCliError && /not found/.test(error.message)) throw error;
    throw new ShopifyCliError(
      `Could not inspect Shopify CLI support for ${formatShopifyCommand(commandArgs)}: ${redactSensitiveText(error.message)}`,
      {
        command: formatShopifyCommand(args),
        hints: [
          "Upgrade the Shopify CLI to a version that provides --json for store commands (validated with 5.0.0).",
          "Use --dry-run to exercise artifact writing without the Shopify CLI.",
        ],
      },
    );
  }

  if (!/--json\b/.test(helpText)) {
    const version = await getShopifyVersion();
    throw new ShopifyCliError(
      `Shopify CLI ${version} does not advertise --json for ${formatShopifyCommand(commandArgs)}. ` +
        "This runtime requires JSON store-command output so accessUrl is never screen-scraped.",
      {
        command: formatShopifyCommand([...commandArgs, "--json"]),
        hints: [
          "Upgrade the Shopify CLI (flags validated against Shopify CLI 5.0.0).",
          "If your CLI version changed the flags, keep --json where available and update the runtime compatibility probe.",
          "Use --dry-run to exercise artifact writing without the Shopify CLI.",
        ],
      },
    );
  }

  const capability = { json: true, version: await getShopifyVersion() };
  capabilityCache.set(cacheKey, capability);
  return capability;
}

export async function createPreviewStore({ name, country }) {
  if (!name || !name.trim()) throw new Error("--name is required for create/connect");
  await assertJsonCommandSupport(["store", "create", "preview"]);

  const args = ["store", "create", "preview", "--name", name.trim(), "--json"];
  if (country) args.push("--country", String(country).trim().toUpperCase());
  const { stdout } = await execShopify(args, "Preview Store creation");
  return { payload: stdout, command: formatShopifyCommand(args) };
}

export async function getStoreInfo(domain) {
  await assertJsonCommandSupport(["store", "info"]);
  const args = ["store", "info", "--store", domain, "--json"];
  const { stdout } = await execShopify(args, "Store info read");
  return { payload: stdout, command: formatShopifyCommand(args) };
}

export async function openStoreSession(domain) {
  await assertJsonCommandSupport(["store", "open"]);
  const args = ["store", "open", "--store", domain, "--json"];
  const { stdout } = await execShopify(args, "Store open");
  return { payload: stdout, command: formatShopifyCommand(args) };
}

export function getShopifyBin() {
  return SHOPIFY_BIN;
}
