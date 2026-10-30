import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { attributeWrite, escapeHtml } from "./copy.js";
import { redactSensitiveText } from "./redact.js";

const execFileAsync = promisify(execFile);
const DEFAULT_SHOPIFY_BIN = process.env.SHOPIFY_CLI_BIN || "shopify";
const DEFAULT_TIMEOUT_MS = Number(process.env.SHOPIFY_CLI_TIMEOUT_MS || 120_000);

export const PRODUCT_LOOKUP_QUERY = `query WorkshopOptimizerProduct($query: String!) {
  products(first: 1, query: $query) {
    nodes { id handle }
  }
}`;

export const PRODUCT_UPDATE_MUTATION = `mutation WorkshopOptimizerProductUpdate($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id handle }
    userErrors { field message }
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

function assertAllowedQuery(query) {
  const trimmed = String(query || "").trim();
  if (trimmed === PRODUCT_LOOKUP_QUERY.trim() || trimmed === PRODUCT_UPDATE_MUTATION.trim()) return;
  throw new ShopifyExecuteError("Refusing a Shopify operation outside the workshop product field update");
}

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

export function formatShopifyCommand(args) {
  return [DEFAULT_SHOPIFY_BIN, ...args].join(" ");
}

export async function executeShopifyGraphQL({
  domain,
  query,
  variables = {},
  allowMutations = false,
  shopifyBin = DEFAULT_SHOPIFY_BIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  execFileImpl = execFileAsync,
}) {
  assertAllowedQuery(query);
  if (/password|passwordProtection|publishablePublish|theme/i.test(query)) {
    throw new ShopifyExecuteError("Refusing a Shopify operation outside the workshop product field update");
  }
  if (allowMutations && !query.includes("productUpdate")) {
    throw new ShopifyExecuteError("Refusing mutations other than productUpdate");
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
    "--no-input",
  ];
  if (allowMutations) args.push("--allow-mutations");

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
        hints: ["Install Shopify CLI 5+ and sign in before a live apply.", "Use apply --confirm --dry-run to write fixtures."],
      });
    }
    const detail = String(error.stderr || error.stdout || error.message || "Shopify CLI command failed").trim();
    throw new ShopifyExecuteError(`Shopify Admin command failed: ${detail}`, {
      command: formatShopifyCommand(args),
      hints: ["Confirm the Preview Store connection and CLI cached auth.", "Use apply --confirm --approve-all-p0 --dry-run to skip Shopify."],
    });
  }

  const payload = extractJson(stdout);
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new ShopifyExecuteError(
      `Shopify Admin GraphQL returned errors: ${payload.errors.map((entry) => entry.message || String(entry)).join("; ")}`,
      { command: formatShopifyCommand(args) },
    );
  }
  if (payload.data && typeof payload.data === "object") return payload.data;
  return payload;
}

function firstUserError(userErrors) {
  if (!Array.isArray(userErrors) || userErrors.length === 0) return null;
  return userErrors
    .map((entry) => `${Array.isArray(entry.field) ? entry.field.join(".") : entry.field || "input"}: ${entry.message || "unknown error"}`)
    .join("; ");
}

export function buildProductInput(id, items, constraints) {
  const input = { id };
  const byField = new Map(items.map((item) => [item.field, item]));
  if (byField.has("title")) input.title = byField.get("title").after;
  if (byField.has("description")) {
    input.descriptionHtml = `<p>${escapeHtml(byField.get("description").after)}</p>`;
  }
  const seo = {};
  if (byField.has("meta_title")) seo.title = byField.get("meta_title").after;
  if (byField.has("meta_description")) seo.description = byField.get("meta_description").after;
  if (Object.keys(seo).length > 0) input.seo = seo;
  if (byField.has("key_attributes")) {
    const attrs = attributeWrite(constraints);
    input.productType = attrs.productType;
    if (attrs.tags.length > 0) input.tags = attrs.tags;
  }
  return input;
}

async function findProduct({ domain, handle, executeGraphql }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(handle)) {
    throw new ShopifyExecuteError(`Refusing to query an unsafe product handle "${handle}"`);
  }
  const data = await executeGraphql({
    domain,
    query: PRODUCT_LOOKUP_QUERY,
    variables: { query: `handle:${handle}` },
    allowMutations: false,
  });
  const nodes = data?.products?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const match = nodes.find((node) => node?.handle === handle) || nodes[0];
  if (!match?.id || match.handle !== handle) return null;
  return { id: match.id, handle: match.handle };
}

export async function updateApprovedProducts({
  domain,
  suggestions,
  constraints,
  executeGraphql = executeShopifyGraphQL,
}) {
  const byHandle = new Map();
  for (const item of suggestions) {
    if (!byHandle.has(item.handle)) byHandle.set(item.handle, []);
    byHandle.get(item.handle).push(item);
  }
  const updated = [];
  for (const [handle, items] of byHandle) {
    const found = await findProduct({ domain, handle, executeGraphql });
    if (!found) {
      throw new ShopifyExecuteError(`No Admin product found for handle ${handle}`, {
        hints: ["Import the product before applying P0 copy.", "Use --dry-run to write fixtures without Shopify."],
      });
    }
    const input = buildProductInput(found.id, items, constraints);
    const data = await executeGraphql({
      domain,
      query: PRODUCT_UPDATE_MUTATION,
      variables: { product: input },
      allowMutations: true,
    });
    const userError = firstUserError(data?.productUpdate?.userErrors);
    if (userError) {
      throw new ShopifyExecuteError(`productUpdate failed for ${handle}: ${userError}`);
    }
    updated.push({ handle, id: found.id });
  }
  return updated;
}
