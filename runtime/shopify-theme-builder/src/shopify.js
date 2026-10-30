import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redactSensitiveText } from "./redact.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_THEME_PUSH_TIMEOUT_MS = 210_000;
export const MAX_THEME_PUSH_TIMEOUT_MS = 240_000;

export function resolveThemePushTimeoutMs(envValue = process.env.SHOPIFY_THEME_PUSH_TIMEOUT_MS) {
  if (envValue === undefined || envValue === null || String(envValue).trim() === "") {
    return DEFAULT_THEME_PUSH_TIMEOUT_MS;
  }
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_THEME_PUSH_TIMEOUT_MS;
  return Math.min(Math.floor(parsed), MAX_THEME_PUSH_TIMEOUT_MS);
}

export class ThemeUploadError extends Error {
  constructor(message, { reason = "push_failed", command = null } = {}) {
    super(redactSensitiveText(message));
    this.name = "ThemeUploadError";
    this.reason = reason;
    this.command = command;
  }
}

export function isTimeoutError(error) {
  if (!error) return false;
  if (error.code === "ETIMEDOUT" || error.killed) return true;
  return /timed out|timeout|ETIMEDOUT/i.test(String(error.message || ""));
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function formatShopifyCommand(bin, args) {
  return [bin, ...args].map(shellQuote).join(" ");
}

export function assertProbeAllowed(args) {
  if (args.includes("publish") || args.includes("dev") || args.includes("--live") || args.includes("development")) {
    throw new ThemeUploadError("Refusing forbidden Shopify theme command.", { reason: "push_failed" });
  }
  if (args[0] !== "theme" || !["push", "share"].includes(args[1]) || !args.includes("--help")) {
    throw new ThemeUploadError("Refusing unexpected Shopify CLI probe.", { reason: "push_failed" });
  }
}

export function assertUploadAllowed(args) {
  if (args.includes("publish") || args.includes("dev") || args.includes("--live") || args.includes("development")) {
    throw new ThemeUploadError("Refusing forbidden Shopify theme command.", { reason: "push_failed" });
  }
  if (args[0] !== "theme") {
    throw new ThemeUploadError("Refusing a Shopify command that is not a theme upload.", { reason: "push_failed" });
  }
  if (args[1] === "push") {
    if (!args.includes("--unpublished") || !args.includes("--json")) {
      throw new ThemeUploadError("Refusing theme push that is not an unpublished JSON upload.", {
        reason: "push_failed",
      });
    }
    return;
  }
  if (args[1] === "share") {
    if (!args.includes("--json")) {
      throw new ThemeUploadError("Refusing theme share without --json.", { reason: "push_failed" });
    }
    return;
  }
  throw new ThemeUploadError("Refusing a Shopify theme command that is not unpublished push or share.", {
    reason: "push_failed",
  });
}

export function buildThemePushArgs({ store, themePath }) {
  const args = ["theme", "push", "--unpublished", "--json", "--store", store, "--path", themePath];
  assertUploadAllowed(args);
  return args;
}

export function buildThemeShareArgs({ store, themePath }) {
  const args = ["theme", "share", "--json", "--store", store, "--path", themePath];
  assertUploadAllowed(args);
  return args;
}

export function chooseThemeUploadStrategy({ pushHelp = "", shareHelp = "" }) {
  if (/--unpublished\b/.test(pushHelp) && /--json\b/.test(pushHelp)) return "push";
  if (shareHelp.trim() && /--json\b/.test(shareHelp)) return "share";
  throw new ThemeUploadError(
    "Shopify CLI does not advertise theme push --unpublished --json, and theme share --json is unavailable. Upgrade the Shopify CLI.",
    { reason: "push_failed" },
  );
}

function tryParseObjectAt(input, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return { value: JSON.parse(input.slice(start, index + 1)), end: index + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function extractJsonObjects(text) {
  const input = String(text ?? "");
  const objects = [];
  for (let start = input.indexOf("{"); start !== -1; start = input.indexOf("{", start + 1)) {
    const parsed = tryParseObjectAt(input, start);
    if (!parsed) continue;
    objects.push(parsed.value);
    start = parsed.end - 1;
  }
  if (objects.length === 0) {
    throw new ThemeUploadError("Shopify CLI did not return JSON", { reason: "push_failed" });
  }
  return objects;
}

/**
 * Read a theme id from CLI JSON. The CLI preview URL is ignored so a localhost
 * dev URL, editor URL, or password query never becomes the workshop preview.
 */
export function parseThemePushPayload(stdout) {
  const objects = extractJsonObjects(stdout);
  for (const json of objects) {
    const theme = json && typeof json.theme === "object" && json.theme ? json.theme : json;
    const id = Number(theme && (theme.id ?? theme.theme_id));
    if (!Number.isInteger(id) || id <= 0) continue;
    const role = String((theme && (theme.role || theme.role_name)) || "").trim().toLowerCase();
    if (role && role !== "unpublished") {
      throw new ThemeUploadError(
        `Refusing to record a theme whose role is "${role}". Workshop themes must stay unpublished.`,
        { reason: "refused_live_role" },
      );
    }
    return {
      theme_id: id,
      role: "unpublished",
      name: theme && typeof theme.name === "string" ? theme.name : null,
    };
  }
  throw new ThemeUploadError("Theme upload JSON did not include a theme id", { reason: "push_failed" });
}

async function runShopify(execFileImpl, bin, args, { timeoutMs, cwd, action }) {
  try {
    return await execFileImpl(bin, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      cwd,
      env: { ...process.env, SHOPIFY_FLAG_NO_COLOR: "1" },
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ThemeUploadError(`Shopify CLI executable "${bin}" was not found`, {
        reason: "push_failed",
        command: formatShopifyCommand(bin, args),
      });
    }
    const exitCode = typeof error.code === "number" ? error.code : null;
    const detail = redactSensitiveText(String(error.stderr || error.stdout || error.message || "Shopify CLI command failed"));
    throw new ThemeUploadError(
      `${action} failed${exitCode === null ? "" : ` (exit ${exitCode})`}: ${detail}`,
      {
        reason: isTimeoutError(error) ? "timeout" : "push_failed",
        command: formatShopifyCommand(bin, args),
      },
    );
  }
}

export async function pushUnpublishedTheme({
  store,
  themePath,
  shopifyBin = process.env.SHOPIFY_CLI_BIN || "shopify",
  timeoutMs = resolveThemePushTimeoutMs(),
  execFileImpl = execFileAsync,
}) {
  const pushHelpArgs = ["theme", "push", "--help"];
  assertProbeAllowed(pushHelpArgs);
  const pushHelp = await runShopify(execFileImpl, shopifyBin, pushHelpArgs, {
    timeoutMs,
    cwd: themePath,
    action: "Theme push compatibility check",
  });
  const pushHelpText = `${pushHelp.stdout || ""}\n${pushHelp.stderr || ""}`;

  let strategy = "push";
  if (!(/--unpublished\b/.test(pushHelpText) && /--json\b/.test(pushHelpText))) {
    const shareHelpArgs = ["theme", "share", "--help"];
    assertProbeAllowed(shareHelpArgs);
    const shareHelp = await runShopify(execFileImpl, shopifyBin, shareHelpArgs, {
      timeoutMs,
      cwd: themePath,
      action: "Theme share compatibility check",
    });
    strategy = chooseThemeUploadStrategy({
      pushHelp: pushHelpText,
      shareHelp: `${shareHelp.stdout || ""}\n${shareHelp.stderr || ""}`,
    });
  }

  const args = strategy === "share"
    ? buildThemeShareArgs({ store, themePath })
    : buildThemePushArgs({ store, themePath });
  const uploaded = await runShopify(execFileImpl, shopifyBin, args, {
    timeoutMs,
    cwd: themePath,
    action: strategy === "share" ? "Theme share" : "Theme push",
  });
  const parsed = parseThemePushPayload(`${uploaded.stdout || ""}\n${uploaded.stderr || ""}`);
  return { ...parsed, upload_strategy: strategy, shopify_called: true };
}

export async function resolveThemeUpload({ mode, push, loadDemo, loadFixture }) {
  if (mode === "demo") {
    const manifest = await loadDemo("demo_flag");
    return { manifest, shopify_called: false, fallback_reason: "demo_flag" };
  }
  if (mode === "dry-run") {
    const manifest = await loadFixture();
    return { manifest, shopify_called: false, fallback_reason: null };
  }
  try {
    const manifest = await push();
    return { manifest, shopify_called: true, fallback_reason: null };
  } catch (error) {
    const reason = error && error.reason ? error.reason : isTimeoutError(error) ? "timeout" : "push_failed";
    const manifest = await loadDemo(reason);
    manifest.fallback_reason = reason;
    manifest.push_error = redactSensitiveText(error && error.message ? error.message : "Theme upload failed").slice(0, 500);
    manifest.shopify_called = true;
    return { manifest, shopify_called: true, fallback_reason: reason };
  }
}
