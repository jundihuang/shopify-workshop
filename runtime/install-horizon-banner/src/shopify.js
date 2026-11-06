import { execFile, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { redactSensitiveText } from "./redact.js";

const execFileAsync = promisify(execFile);
const DEFAULT_SHOPIFY_BIN = process.env.SHOPIFY_CLI_BIN || "shopify";
const DEFAULT_TIMEOUT_MS = Number(process.env.SHOPIFY_CLI_TIMEOUT_MS || 180_000);

export const THEMES_QUERY = `query WorkshopThemes {
  themes(first: 20) { nodes { id name role } }
}`;

export function themeFileQuery() {
  return `query WorkshopThemeFile($themeId: ID!) {
  theme(id: $themeId) {
    id name role
    files(filenames: ["templates/index.json"]) {
      nodes { filename body { __typename ... on OnlineStoreThemeFileBodyText { content } } }
    }
  }
}`;
}

export const FILE_CREATE_MUTATION = `mutation WorkshopBannerFileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) { files { id fileStatus } userErrors { field message } }
}`;

export const STAGED_UPLOADS_CREATE_MUTATION = `mutation WorkshopBannerStagedUpload($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`;

export function fileNodeQuery() {
  return `query WorkshopBannerFile($fileId: ID!) {
  node(id: $fileId) { id ... on MediaImage { fileStatus image { url width height } } }
}`;
}

export const THEME_FILES_UPSERT_MUTATION = `mutation WorkshopBannerThemeUpsert(
  $themeId: ID!
  $files: [OnlineStoreThemeFilesUpsertFileInput!]!
) {
  themeFilesUpsert(themeId: $themeId, files: $files) {
    job { id done }
    userErrors { field filename message }
  }
}`;

export class ShopifyExecuteError extends Error {
  constructor(message, { command = null, hints = [] } = {}) {
    super(redactSensitiveText(message));
    this.name = "ShopifyExecuteError";
    this.command = command;
    this.hints = hints;
  }
}

// On Windows the npm-installed Shopify CLI only exists as a `.cmd`/sh shim that
// execFile cannot launch. Resolve `shopify` to node + the global
// @shopify/cli/bin/run.js so the same logical args keep working.
let cachedWindowsCliJs;
function resolveWindowsShopifyInvocation(bin, args) {
  if (process.platform !== "win32" || bin !== "shopify") return { bin, args };
  if (cachedWindowsCliJs === undefined) {
    cachedWindowsCliJs = null;
    if (process.env.SHOPIFY_CLI_JS && existsSync(process.env.SHOPIFY_CLI_JS)) {
      cachedWindowsCliJs = process.env.SHOPIFY_CLI_JS;
    } else {
      try {
        const whereOut = execSync("where shopify.cmd", {
          encoding: "utf8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "ignore"],
        });
        const cmdPath = whereOut.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
        if (cmdPath) {
          const cliJs = join(dirname(cmdPath), "node_modules", "@shopify", "cli", "bin", "run.js");
          if (existsSync(cliJs)) cachedWindowsCliJs = cliJs;
        }
      } catch {
        cachedWindowsCliJs = null;
      }
    }
  }
  if (!cachedWindowsCliJs) return { bin, args };
  return { bin: process.execPath, args: [cachedWindowsCliJs, ...args] };
}

/**
 * Shopify CLI 5 prints NDJSON progress lines to stdout/stderr followed by the
 * pretty-printed result JSON. Extract that final JSON object.
 */
export function extractResultJson(raw) {
  const text = String(raw ?? "");
  const lines = text.split(/\r?\n/);
  const dataLine = lines.findIndex((line) => line.trim().startsWith('"data": {') || line.trim().startsWith('"data":{'));
  if (dataLine === -1) {
    throw new ShopifyExecuteError(
      `shopify store execute returned no result JSON. Tail: ${text.slice(-200)}`,
      { hints: ["Check CLI sign-in and that the Preview Store authentication is still valid."] },
    );
  }
  const collected = [];
  for (let index = dataLine; index < lines.length; index += 1) {
    const line = lines[index];
    if (collected.length > 0 && line.trim().startsWith('{"type"')) break;
    collected.push(line);
  }
  let json = `{\n${collected.join("\n")}`;
  for (let end = collected.length; end >= 1; end -= 1) {
    const candidate = `{\n${collected.slice(0, end).join("\n")}`;
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new ShopifyExecuteError(`Could not parse shopify store execute result: ${error.message}`);
  }
}

function assertQueryAllowed(query, allowMutations) {
  if (/password|passwordProtection|themePublish/i.test(query)) {
    throw new ShopifyExecuteError("Refusing a Shopify operation outside the Horizon banner install scope");
  }
  if (/^\s*mutation/.test(query) && !allowMutations) {
    throw new ShopifyExecuteError("Refusing a mutation without allowMutations enabled");
  }
}

export async function executeBannerGraphQL({
  domain,
  query,
  variables = {},
  allowMutations = false,
  shopifyBin = DEFAULT_SHOPIFY_BIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  execFileImpl = execFileAsync,
}) {
  assertQueryAllowed(query, allowMutations);
  const args = [
    "store", "execute",
    "--store", domain,
    "--query", query,
    "--variables", JSON.stringify(variables),
    "--json", "--no-input",
  ];
  if (allowMutations) args.push("--allow-mutations");
  const invocation = resolveWindowsShopifyInvocation(shopifyBin, args);
  let stdout;
  try {
    const result = await execFileImpl(invocation.bin, invocation.args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, SHOPIFY_FLAG_NO_COLOR: "1" },
    });
    stdout = result.stdout;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ShopifyExecuteError(`Shopify CLI executable "${shopifyBin}" was not found`, {
        command: `shopify ${args.slice(0, 2).join(" ")}`,
        hints: [
          "Install Shopify CLI 5+ and sign in before installing the banner.",
          "Use apply --confirm --dry-run to exercise the flow without Shopify.",
        ],
      });
    }
    const detail = String(error.stderr || error.stdout || error.message).split(/\r?\n/)
      .filter((line) => line.trim() && !/^\s*\{\s*"type"\s*:\s*"progress"/.test(line))
      .join("\n").trim();
    throw new ShopifyExecuteError(`shopify store execute failed: ${redactSensitiveText(detail).slice(0, 400)}`, {
      command: `shopify ${args.slice(0, 2).join(" ")}`,
      hints: ["The Preview Store may have been claimed; re-run shopify store auth if needed."],
    });
  }
  const parsed = extractResultJson(stdout);
  if (parsed.errors) {
    const messages = Array.isArray(parsed.errors)
      ? parsed.errors.map((entry) => entry.message || JSON.stringify(entry)).join("; ")
      : JSON.stringify(parsed.errors);
    throw new ShopifyExecuteError(`GraphQL error: ${messages.slice(0, 400)}`);
  }
  return parsed.data;
}
