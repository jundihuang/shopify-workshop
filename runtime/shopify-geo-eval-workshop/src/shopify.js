import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ADMIN_PROBE_LIMIT } from "./paths.js";
import { redactSensitiveText } from "./redact.js";
import { normalizeProduct } from "./score.js";

const execFileAsync = promisify(execFile);
const DEFAULT_SHOPIFY_BIN = process.env.SHOPIFY_CLI_BIN || "shopify";
const DEFAULT_TIMEOUT_MS = Number(process.env.SHOPIFY_CLI_TIMEOUT_MS || 120_000);

/**
 * Read-only Admin product fields for the workshop sample.
 * Does not request password fields and is not a mutation.
 */
export const PRODUCTS_QUERY = `query WorkshopGeoProducts($first: Int!) {
  products(first: $first, sortKey: TITLE) {
    nodes {
      id
      handle
      title
      description
      productType
      vendor
      status
      tags
      seo { title description }
      options { name values }
      featuredMedia { alt preview { image { url } } }
      variants(first: 5) { nodes { sku price } }
      metafields(first: 15) { nodes { namespace key value } }
    }
  }
}`;

function extractJson(text) {
  const input = String(text ?? "");
  try {
    return JSON.parse(input);
  } catch {
    // Shopify CLI may include informational event lines around the JSON body.
  }
  for (let start = input.indexOf("{"); start !== -1; start = input.indexOf("{", start + 1)) {
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
            return JSON.parse(input.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error("Shopify CLI did not return valid JSON");
}

export class ShopifyExecuteError extends Error {
  constructor(message, { command = null, hints = [] } = {}) {
    super(redactSensitiveText(message));
    this.name = "ShopifyExecuteError";
    this.command = command;
    this.hints = hints;
  }
}

export function formatShopifyCommand(args) {
  return [DEFAULT_SHOPIFY_BIN, ...args].join(" ");
}

async function runShopify(args, { shopifyBin = DEFAULT_SHOPIFY_BIN, timeoutMs = DEFAULT_TIMEOUT_MS, execFileImpl = execFileAsync } = {}) {
  if (args.includes("--allow-mutations") || args.includes("theme") || args.includes("publish")) {
    throw new ShopifyExecuteError("Refusing a Shopify command that is not a read-only workshop GEO read");
  }
  let stdout;
  try {
    const result = await execFileImpl(shopifyBin, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, SHOPIFY_FLAG_NO_COLOR: "1" },
    });
    stdout = result.stdout;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ShopifyExecuteError(`Shopify CLI executable "${shopifyBin}" was not found`, {
        command: formatShopifyCommand(args),
        hints: ["Install Shopify CLI 5+ and sign in before a live score.", "Use apply --confirm --dry-run to score the fixture sample."],
      });
    }
    const detail = String(error.stderr || error.stdout || error.message || "Shopify CLI command failed").trim();
    throw new ShopifyExecuteError(`Shopify read command failed: ${detail}`, {
      command: formatShopifyCommand(args),
      hints: [
        "Confirm the Preview Store connection and CLI cached auth.",
        "Use apply --confirm --dry-run to score fixtures without calling Shopify.",
      ],
    });
  }
  return extractJson(stdout);
}

export async function executeShopifyGraphQL({
  domain,
  query,
  variables = {},
  shopifyBin = DEFAULT_SHOPIFY_BIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  execFileImpl = execFileAsync,
}) {
  if (typeof query !== "string" || !/^\s*query\b/.test(query)) {
    throw new ShopifyExecuteError("Refusing to run a Shopify operation that is not a read-only query");
  }
  if (/password|passwordProtectionUpdate|mutation\b/i.test(query)) {
    throw new ShopifyExecuteError("Refusing a query that asks for a password or a mutation");
  }
  const args = [
    "store",
    "execute",
    "--store",
    domain,
    "--query",
    query,
    "--variables",
    JSON.stringify(variables),
    "--json",
  ];
  const payload = await runShopify(args, { shopifyBin, timeoutMs, execFileImpl });
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new ShopifyExecuteError(
      `Shopify Admin GraphQL returned errors: ${payload.errors.map((entry) => entry.message || String(entry)).join("; ")}`,
      { command: formatShopifyCommand(args) },
    );
  }
  if (payload.data && typeof payload.data === "object") return payload.data;
  return payload;
}

export async function fetchAdminProducts({
  domain,
  executeGraphql = executeShopifyGraphQL,
  first = ADMIN_PROBE_LIMIT,
}) {
  const data = await executeGraphql({
    domain,
    query: PRODUCTS_QUERY,
    variables: { first },
  });
  const nodes = data?.products?.nodes;
  if (!Array.isArray(nodes)) {
    throw new ShopifyExecuteError("Shopify Admin product query did not return products.nodes");
  }
  return nodes.map((node) => normalizeProduct(node)).filter(Boolean);
}

/**
 * Resolve the current CLI session URL in memory. Callers must not persist it.
 */
export async function readStoreInfoAccessUrl({
  domain,
  shopifyBin = DEFAULT_SHOPIFY_BIN,
  timeoutMs = 20_000,
  execFileImpl = execFileAsync,
}) {
  const args = ["store", "info", "--store", domain, "--json"];
  const payload = await runShopify(args, { shopifyBin, timeoutMs, execFileImpl });
  const value = payload?.accessUrl ?? payload?.access_url ?? payload?.store?.accessUrl;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
