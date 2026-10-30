import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redactSensitiveText } from "./redact.js";

const execFileAsync = promisify(execFile);
const DEFAULT_SHOPIFY_BIN = process.env.SHOPIFY_CLI_BIN || "shopify";
const DEFAULT_TIMEOUT_MS = Number(process.env.SHOPIFY_CLI_TIMEOUT_MS || 180_000);

export const PUBLICATIONS_QUERY = `query WorkshopOnlineStorePublication {
  publications(first: 50) {
    nodes {
      id
      name
    }
  }
}`;

export const DRAFT_PRODUCTS_QUERY = `query WorkshopDraftProducts {
  products(first: 50, query: "status:draft") {
    nodes {
      id
      handle
      title
      status
    }
  }
}`;

export const PRODUCT_ACTIVE_MUTATION = `mutation WorkshopActivateProduct($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product {
      id
      handle
      title
      status
    }
    userErrors {
      field
      message
    }
  }
}`;

export const PUBLISHABLE_PUBLISH_MUTATION = `mutation WorkshopPublishProductToOnlineStore($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    userErrors {
      field
      message
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

export async function executeShopifyGraphQL({
  domain,
  query,
  variables = {},
  shopifyBin = DEFAULT_SHOPIFY_BIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const args = [
    "store",
    "execute",
    "--store",
    domain,
    "--query",
    query,
    "--variables",
    JSON.stringify(variables),
    "--allow-mutations",
    "--json",
    "--no-input",
  ];

  let stdout;
  try {
    const result = await execFileAsync(shopifyBin, args, {
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
        hints: [
          "Install Shopify CLI 5+ and sign in before real channel publishing.",
          "Use plan / apply --dry-run to inspect the workflow without network writes.",
        ],
      });
    }
    const detail = String(error.stderr || error.stdout || error.message || "Shopify CLI command failed").trim();
    throw new ShopifyExecuteError(`Shopify Admin GraphQL command failed: ${detail}`, {
      command: formatShopifyCommand(args),
      hints: [
        "Confirm the Preview Store connection and CLI cached auth: shopify store auth --store <domain>.",
        "Retry once for transient network errors.",
        "Use apply --dry-run --confirm to inspect artifacts without writing products.",
      ],
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

function nodesFromConnection(connection) {
  if (!connection || typeof connection !== "object") return [];
  if (Array.isArray(connection.nodes)) return connection.nodes;
  if (Array.isArray(connection.edges)) {
    return connection.edges.map((edge) => edge?.node).filter(Boolean);
  }
  return [];
}

export async function fetchOnlineStorePublication({ domain, executeGraphql = executeShopifyGraphQL }) {
  const data = await executeGraphql({ domain, query: PUBLICATIONS_QUERY, variables: {} });
  const publications = nodesFromConnection(data.publications);
  const exact = publications.find((publication) => String(publication.name || "").trim().toLowerCase() === "online store");
  const publication = exact ?? publications.find((publication) => /online\s*store/i.test(String(publication.name || "")));
  if (!publication?.id) {
    throw new ShopifyExecuteError("Could not find the Online Store publication for this Preview Store", {
      hints: [
        "Confirm the store has an Online Store sales channel.",
        "Retry plan once after re-running shopify-store-connect verify.",
      ],
    });
  }
  return { id: publication.id, name: publication.name || "Online Store" };
}

export async function listDraftProducts({ domain, executeGraphql = executeShopifyGraphQL }) {
  const data = await executeGraphql({ domain, query: DRAFT_PRODUCTS_QUERY, variables: {} });
  return nodesFromConnection(data.products)
    .filter((product) => product?.id && String(product.status || "DRAFT").toUpperCase() === "DRAFT")
    .map((product) => ({
      product_id: product.id,
      handle: product.handle || null,
      title: product.title || null,
      current_status: "draft",
      source: "admin_draft_products",
    }));
}

export async function activateAndPublishProduct({
  domain,
  product,
  publicationId,
  executeGraphql = executeShopifyGraphQL,
}) {
  const activated = await executeGraphql({
    domain,
    query: PRODUCT_ACTIVE_MUTATION,
    variables: { product: { id: product.product_id, status: "ACTIVE" } },
  });
  const updatePayload = activated.productUpdate ?? {};
  const updateError = firstUserError(updatePayload.userErrors);
  if (updateError) {
    return {
      ...product,
      ok: false,
      stage: "productUpdate",
      status_after: null,
      published_to_online_store: false,
      errors: [redactSensitiveText(updateError)],
    };
  }

  const published = await executeGraphql({
    domain,
    query: PUBLISHABLE_PUBLISH_MUTATION,
    variables: { id: product.product_id, input: [{ publicationId }] },
  });
  const publishPayload = published.publishablePublish ?? {};
  const publishError = firstUserError(publishPayload.userErrors);
  if (publishError) {
    return {
      ...product,
      ok: false,
      stage: "publishablePublish",
      status_after: updatePayload.product?.status || "ACTIVE",
      published_to_online_store: false,
      errors: [redactSensitiveText(publishError)],
    };
  }

  return {
    ...product,
    ok: true,
    status_after: updatePayload.product?.status || "ACTIVE",
    published_to_online_store: true,
    errors: [],
  };
}
