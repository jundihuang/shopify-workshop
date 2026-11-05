import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readJsonFile } from "./files.js";
import { redactSensitiveText } from "./redact.js";

const execFileAsync = promisify(execFile);
const DEFAULT_SHOPIFY_BIN = process.env.SHOPIFY_CLI_BIN || "shopify";
const DEFAULT_TIMEOUT_MS = Number(process.env.SHOPIFY_CLI_TIMEOUT_MS || 180_000);

const PRODUCT_CREATE_MUTATION = `mutation ProductDraftCreate($input: ProductInput!) {
  productCreate(input: $input) {
    product { id handle title status variants(first: 1) { nodes { id } } }
    userErrors { field message }
  }
}`;

const VARIANT_CREATE_MUTATION = `mutation ProductVariantCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants) {
    productVariants { id sku price }
    userErrors { field message }
  }
}`;

const VARIANT_UPDATE_MUTATION = `mutation ProductVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id sku price }
    userErrors { field message }
  }
}`;

const PRODUCT_MEDIA_MUTATION = `mutation ProductMediaAttach($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { id status }
    mediaUserErrors { field message }
  }
}`;

// Shopify CLI 5 writes NDJSON progress to stderr and the error JSON to stdout.
// Strip progress noise and prefer the structured error payload.
function cliFailureDetail(error, fallback = "Shopify CLI command failed") {
  const dropProgress = (text) =>
    String(text || "")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !/^\s*\{\s*"type"\s*:\s*"progress"/.test(line))
      .join("\n")
      .trim();
  const stdoutDetail = dropProgress(error.stdout);
  const stderrDetail = dropProgress(error.stderr);
  if (stdoutDetail) return stdoutDetail;
  if (stderrDetail) return stderrDetail;
  return String(error.message || fallback);
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
          "Install Shopify CLI 5+ and sign in before a real import.",
          "Use --dry-run to exercise validation and artifact writing without network writes.",
        ],
      });
    }
    const detail = cliFailureDetail(error);
    throw new ShopifyExecuteError(`Shopify Admin GraphQL command failed: ${detail}`, {
      command: formatShopifyCommand(args),
      hints: [
        "Confirm the Preview Store connection and CLI cached auth: shopify store auth --store <domain>.",
        "Retry once for transient network errors.",
        "Use --dry-run to inspect import artifacts without writing products.",
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
  if (payload.productCreate || payload.productVariantsBulkCreate) return payload;
  throw new ShopifyExecuteError("Shopify Admin GraphQL response did not include a data object", {
    command: formatShopifyCommand(args),
  });
}

function firstUserError(userErrors) {
  if (!Array.isArray(userErrors) || userErrors.length === 0) return null;
  return userErrors
    .map((entry) => `${Array.isArray(entry.field) ? entry.field.join(".") : entry.field || "input"}: ${entry.message || "unknown error"}`)
    .join("; ");
}

function productInput(product) {
  const data = product.data;
  const input = {
    title: data.title,
    descriptionHtml: data.description || "",
    status: "DRAFT",
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
  if (data.handle) input.handle = data.handle;
  if (data.vendor) input.vendor = data.vendor;
  if (data.product_type) input.productType = data.product_type;
  const seoTitle = String(data.seo_title || "").trim();
  const seoDescription = String(data.seo_description || "").trim();
  if (seoTitle || seoDescription) {
    input.seo = {};
    if (seoTitle) input.seo.title = seoTitle;
    if (seoDescription) input.seo.description = seoDescription;
  }
  // Deliberately no publishedAt, publications, or Online Store channel input.
  return input;
}

function variantInput(product, variantId = null) {
  const data = product.data;
  // Admin API 2025+ moved SKU off ProductVariantsBulkInput into inventoryItem.sku.
  const variant = {
    price: data.price,
    inventoryItem: { sku: data.sku },
    inventoryPolicy: "DENY",
    taxable: true,
  };
  if (variantId) variant.id = variantId;
  if (data.compare_at_price) variant.compareAtPrice = data.compare_at_price;
  return variant;
}

async function fakeProductResult(product, rowIndex, fixturesDir) {
  const fixture = await readJsonFile(path.join(fixturesDir, "product-create.success.json"));
  const baseProduct = fixture?.data?.productCreate?.product ?? {};
  const baseId = String(baseProduct.id || "gid://shopify/Product/9000001000");
  const productId = baseId.replace(/\d+$/, String(9000001000 + rowIndex));
  return {
    row_number: product.row_number,
    sku: product.data.sku,
    title: product.data.title,
    handle: product.data.handle,
    ok: true,
    fake: true,
    shopify_status: "draft",
    product_id: productId,
    variant_id: `${productId.replace("Product", "ProductVariant")}1`,
    channels_published: false,
  };
}

async function createOneDraftProduct(product, { domain, executeGraphql, fixturesDir, rowIndex, dryRun }) {
  if (dryRun) return fakeProductResult(product, rowIndex, fixturesDir);

  const created = await executeGraphql({
    domain,
    query: PRODUCT_CREATE_MUTATION,
    variables: { input: productInput(product) },
  });
  const createPayload = created.productCreate ?? {};
  const createError = firstUserError(createPayload.userErrors);
  if (createError) {
    return {
      row_number: product.row_number,
      sku: product.data.sku,
      title: product.data.title,
      handle: product.data.handle,
      ok: false,
      shopify_status: "draft",
      stage: "productCreate",
      error: redactSensitiveText(createError),
      channels_published: false,
    };
  }
  const createdProduct = createPayload.product;
  if (!createdProduct?.id) {
    return {
      row_number: product.row_number,
      sku: product.data.sku,
      title: product.data.title,
      handle: product.data.handle,
      ok: false,
      shopify_status: "draft",
      stage: "productCreate",
      error: "Shopify did not return a product id",
      channels_published: false,
    };
  }

  // productCreate on Admin API 2025+ auto-creates a "Default Title" variant;
  // update it in place instead of colliding via productVariantsBulkCreate.
  const defaultVariantId = createdProduct.variants?.nodes?.[0]?.id ?? null;
  const variantResult = await executeGraphql({
    domain,
    query: defaultVariantId ? VARIANT_UPDATE_MUTATION : VARIANT_CREATE_MUTATION,
    variables: { productId: createdProduct.id, variants: [variantInput(product, defaultVariantId)] },
  });
  const variantPayload =
    variantResult.productVariantsBulkUpdate ?? variantResult.productVariantsBulkCreate ?? {};
  const variantError = firstUserError(variantPayload.userErrors);
  const variants = Array.isArray(variantPayload.productVariants) ? variantPayload.productVariants : [];
  if (variantError || variants.length === 0) {
    return {
      row_number: product.row_number,
      sku: product.data.sku,
      title: product.data.title,
      handle: product.data.handle,
      ok: false,
      shopify_status: "draft",
      stage: defaultVariantId ? "productVariantsBulkUpdate" : "productVariantsBulkCreate",
      product_id: createdProduct.id,
      partial: true,
      error: redactSensitiveText(variantError || "Shopify did not return a variant id"),
      channels_published: false,
    };
  }

  // Attach the validated image_url as product media; the workshop scorecard
  // and the storefront both expect at least one image per imported product.
  const imageUrl = String(product.data.image_url || "").trim();
  if (imageUrl) {
    const mediaResult = await executeGraphql({
      domain,
      query: PRODUCT_MEDIA_MUTATION,
      variables: {
        productId: createdProduct.id,
        media: [{ originalSource: imageUrl, mediaContentType: "IMAGE", alt: product.data.title }],
      },
    });
    const mediaPayload = mediaResult.productCreateMedia ?? {};
    const mediaErrors = Array.isArray(mediaPayload.mediaUserErrors) ? mediaPayload.mediaUserErrors : [];
    if (mediaErrors.length > 0) {
      return {
        row_number: product.row_number,
        sku: product.data.sku,
        title: product.data.title,
        handle: product.data.handle,
        ok: false,
        shopify_status: "draft",
        stage: "productCreateMedia",
        product_id: createdProduct.id,
        variant_id: variants[0].id,
        partial: true,
        error: redactSensitiveText(firstUserError(mediaErrors) || "Media attach failed"),
        channels_published: false,
      };
    }
  }

  return {
    row_number: product.row_number,
    sku: product.data.sku,
    title: product.data.title,
    handle: product.data.handle,
    ok: true,
    shopify_status: "draft",
    product_id: createdProduct.id,
    variant_id: variants[0].id,
    price: variants[0].price,
    channels_published: false,
  };
}

export async function importPreview({
  preview,
  domain,
  dryRun = false,
  fixturesDir,
  executeGraphql = executeShopifyGraphQL,
}) {
  const importable = preview.products.filter((product) => product.status !== "blocked");
  const skipped = preview.products.filter((product) => product.status === "blocked");
  const results = [];
  for (let index = 0; index < importable.length; index += 1) {
    const product = importable[index];
    try {
      results.push(
        await createOneDraftProduct(product, {
          domain,
          executeGraphql,
          fixturesDir,
          rowIndex: index + 1,
          dryRun,
        }),
      );
    } catch (error) {
      results.push({
        row_number: product.row_number,
        sku: product.data.sku,
        title: product.data.title,
        handle: product.data.handle,
        ok: false,
        shopify_status: "draft",
        error: redactSensitiveText(error.message),
        channels_published: false,
      });
    }
  }

  const imported = results.filter((result) => result.ok).length;
  const failed = results.length - imported;
  return {
    schema_version: "1.0",
    artifact: "products.import.result.json",
    generated_at: new Date().toISOString(),
    dry_run: Boolean(dryRun),
    fake: Boolean(dryRun),
    mode: dryRun ? "fixture" : "shopify_admin_graphql",
    store: domain,
    store_type: "preview",
    source_file: preview.source_file,
    default_status: "draft",
    shopify_status: "draft",
    channel_publish: false,
    channels_published: false,
    total_rows: preview.total_rows,
    ready: preview.ready,
    warning: preview.warning,
    blocked: preview.blocked,
    importable: importable.length,
    imported,
    failed,
    skipped_blocked: skipped.length,
    results,
  };
}
