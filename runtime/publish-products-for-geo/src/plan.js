import path from "node:path";
import { pathExists, readJsonFile } from "./files.js";
import { listDraftProducts } from "./shopify.js";

export const CONFIRM_COPY = "「为 GEO 演示：发布商品到 Online Store（主题仍不发布）」";
export const MAX_PRODUCTS = 50;

export function importResultPath(groupDir) {
  return path.join(groupDir, "products.import.result.json");
}

export function planArtifactPath(groupDir) {
  return path.join(groupDir, "products.channel.plan.json");
}

export function normalizeProductId(value) {
  const input = String(value ?? "").trim();
  if (!input) throw new Error("--product-id cannot be empty");
  if (/^\d+$/.test(input)) return `gid://shopify/Product/${input}`;
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(input)) {
    throw new Error(`Invalid product id "${input}"; expected gid://shopify/Product/<number> or a numeric id`);
  }
  return input;
}

export function parseProductIdList(values = []) {
  const tokens = values.flatMap((value) => String(value ?? "").split(","));
  const ids = tokens.map((token) => token.trim()).filter(Boolean).map(normalizeProductId);
  return [...new Set(ids)];
}

function productFromImportResult(entry) {
  return {
    product_id: normalizeProductId(entry.product_id),
    handle: entry.handle || null,
    title: entry.title || null,
    sku: entry.sku || null,
    current_status: entry.shopify_status || "draft",
    source: "products.import.result.json",
  };
}

export function extractProductsFromImportResult(result) {
  if (!result || !Array.isArray(result.results)) {
    throw new Error("products.import.result.json does not contain a results array");
  }
  const products = result.results
    .filter((entry) => entry && entry.ok === true && entry.product_id)
    .map(productFromImportResult);
  return dedupeProducts(products);
}

function nodesFromConnection(connection) {
  if (!connection || typeof connection !== "object") return [];
  if (Array.isArray(connection.nodes)) return connection.nodes;
  if (Array.isArray(connection.edges)) {
    return connection.edges.map((edge) => edge?.node).filter(Boolean);
  }
  return [];
}

export function extractDraftProductsFromPayload(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  return nodesFromConnection(data?.products)
    .filter((product) => product?.id && String(product.status || "DRAFT").toUpperCase() === "DRAFT")
    .map((product) => ({
      product_id: normalizeProductId(product.id),
      handle: product.handle || null,
      title: product.title || null,
      sku: null,
      current_status: "draft",
      source: "admin_draft_products",
    }));
}

function dedupeProducts(products) {
  const seen = new Set();
  const output = [];
  for (const product of products) {
    if (seen.has(product.product_id)) continue;
    seen.add(product.product_id);
    output.push(product);
  }
  return output;
}

function explicitProducts(productIds) {
  return productIds.map((productId) => ({
    product_id: productId,
    handle: null,
    title: null,
    sku: null,
    current_status: null,
    source: "explicit_product_ids",
  }));
}

export async function loadPlanProducts({
  groupDir,
  productIds = [],
  dryRun = false,
  executeGraphql,
  fixturesDir,
  domain,
}) {
  if (productIds.length > 0) {
    if (productIds.length > MAX_PRODUCTS) {
      throw new Error(`Refusing to plan more than ${MAX_PRODUCTS} products; provide a smaller explicit --product-id list.`);
    }
    return {
      products: explicitProducts(productIds),
      source: "explicit_product_ids",
      source_artifact: null,
    };
  }

  const resultPath = importResultPath(groupDir);
  if (await pathExists(resultPath)) {
    const result = await readJsonFile(resultPath);
    const products = extractProductsFromImportResult(result);
    if (products.length === 0) {
      throw new Error(
        "products.import.result.json contains no successful product ids. Refusing to fall back to every Draft product.",
      );
    }
    if (products.length > MAX_PRODUCTS) {
      throw new Error(`Refusing to plan more than ${MAX_PRODUCTS} products from the import result.`);
    }
    return {
      products,
      source: "products.import.result.json",
      source_artifact: resultPath,
    };
  }

  // Fallback allowed only when the group import result is absent. In dry-run
  // this uses a bundled fixture; a real run performs a read-only Admin query.
  let products;
  if (dryRun) {
    if (!fixturesDir) throw new Error("A fixtures directory is required to dry-run the Draft-product fallback");
    const fixture = await readJsonFile(path.join(fixturesDir, "draft-products.success.json"));
    products = extractDraftProductsFromPayload(fixture);
  } else {
    products = await listDraftProducts({ domain, executeGraphql });
  }
  if (products.length === 0) {
    throw new Error("No Draft products found to publish. Import products first or provide --product-id values.");
  }
  if (products.length > MAX_PRODUCTS) {
    throw new Error(`Refusing to publish more than ${MAX_PRODUCTS} Draft products; narrow the list explicitly.`);
  }
  return {
    products,
    source: dryRun ? "admin_draft_products_fixture" : "admin_draft_products",
    source_artifact: null,
  };
}

export function buildPlanObject({
  connection,
  products,
  source,
  sourceArtifact,
  dryRun = false,
}) {
  const count = products.length;
  const handles = products.map((product) => product.handle).filter(Boolean);
  const now = new Date().toISOString();
  return {
    schema_version: "1.0",
    artifact: "products.channel.plan.json",
    generated_at: now,
    dry_run: Boolean(dryRun),
    command: "plan",
    store: connection.store,
    store_type: "preview",
    auth: connection.auth,
    source,
    source_artifact: sourceArtifact || null,
    target_publication: {
      name: "Online Store",
      id: null,
      resolved_at_apply: true,
    },
    theme: {
      touched: false,
      published: false,
      expected_status: "unpublished",
    },
    participant_confirm_copy: CONFIRM_COPY,
    risk_one_liner:
      `将把 ${count} 个商品设为 Active 并发布到 Online Store 渠道；主题保持 Unpublished，不触碰店面密码。`,
    products,
    product_ids: products.map((product) => product.product_id),
    handles,
    summary: {
      products_to_activate: count,
      products_to_publish: count,
    },
    writes: ["productUpdate(status=ACTIVE)", "publishablePublish(Online Store)"],
    forbidden_actions: ["publish_theme", "push_live_theme", "read_or_write_storefront_password"],
  };
}
