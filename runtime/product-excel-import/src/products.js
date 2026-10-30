import path from "node:path";
import fs from "node:fs/promises";
import { parseCsv } from "./csv.js";
import { parseXlsx } from "./xlsx.js";

export const SHOPIFY_PLACEHOLDER_IMAGE =
  "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png";

export const DEFAULT_STATUS = "draft";

const FIELD_DEFINITIONS = [
  { field: "handle", aliases: ["handle", "url_handle", "slug"] },
  { field: "title", aliases: ["title", "product_title", "name", "product_name", "商品标题", "标题"] },
  { field: "description", aliases: ["description", "body_html", "description_html", "body", "描述", "商品描述"] },
  { field: "product_type", aliases: ["product_type", "type", "category", "商品类型", "品类"] },
  { field: "vendor", aliases: ["vendor", "供应商"] },
  { field: "tags", aliases: ["tags", "tag", "标签"] },
  { field: "price", aliases: ["price", "价格"] },
  { field: "compare_at_price", aliases: ["compare_at_price", "compare_price", "compare_at", "原价", "划线价"] },
  { field: "sku", aliases: ["sku", "variant_sku", "货号"] },
  { field: "inventory_qty", aliases: ["inventory_qty", "inventory_quantity", "qty", "库存"] },
  { field: "image_url", aliases: ["image_url", "image", "image_src", "图片", "图片链接"] },
  { field: "status", aliases: ["status", "状态"] },
  { field: "seo_title", aliases: ["seo_title", "seo_name", "meta_title"] },
  { field: "seo_description", aliases: ["seo_description", "meta_description"] },
  { field: "faq", aliases: ["faq", "faqs", "常见问题"] },
  { field: "brand", aliases: ["brand", "brand_name", "品牌"] },
  { field: "gtin", aliases: ["gtin", "barcode", "ean", "upc"] },
  { field: "mpn", aliases: ["mpn", "manufacturer_part_number"] },
  { field: "material", aliases: ["material", "材质"] },
  { field: "color", aliases: ["color", "colour", "颜色"] },
  { field: "size", aliases: ["size", "尺码", "尺寸"] },
  {
    field: "google_product_category",
    aliases: ["google_product_category", "google_category", "product_category"],
  },
  { field: "condition", aliases: ["condition", "成色"] },
];

const ALIAS_TO_FIELD = new Map();
for (const definition of FIELD_DEFINITIONS) {
  for (const alias of definition.aliases) ALIAS_TO_FIELD.set(normalizeHeader(alias), definition.field);
}

const REQUIRED_FIELDS = ["title", "description", "price", "sku", "image_url", "product_type"];

export function normalizeHeader(header) {
  return String(header ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug;
}

function mappingFromHeaders(headers) {
  const fieldMap = {};
  const sourceColumns = {};
  const ignoredColumns = [];
  const seenFields = new Set();

  for (const header of headers) {
    const trimmed = String(header ?? "").replace(/^\uFEFF/, "").trim();
    if (!trimmed) continue;
    const canonical = ALIAS_TO_FIELD.get(normalizeHeader(trimmed));
    if (!canonical) {
      ignoredColumns.push(trimmed);
      continue;
    }
    if (seenFields.has(canonical)) {
      ignoredColumns.push(trimmed);
      continue;
    }
    fieldMap[canonical] = trimmed;
    sourceColumns[canonical] = trimmed;
    seenFields.add(canonical);
  }
  return { fieldMap, ignoredColumns };
}

function getCell(record, fieldMap, field) {
  const source = fieldMap[field];
  return source === undefined ? "" : String(record.cells[source] ?? "");
}

function trimmed(record, fieldMap, field) {
  return getCell(record, fieldMap, field).trim();
}

function splitTags(value) {
  return [...new Set(String(value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean))];
}

function parseFaq(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => {
        if (Array.isArray(entry)) return { question: String(entry[0] ?? "").trim(), answer: String(entry[1] ?? "").trim() };
        return {
          question: String(entry.question ?? entry.q ?? "").trim(),
          answer: String(entry.answer ?? entry.a ?? "").trim(),
        };
      }).filter((entry) => entry.question || entry.answer);
    }
  } catch {
    // Fall through to the compact Q|A;;Q|A format.
  }
  return text
    .split(";;")
    .map((pair) => pair.split("|"))
    .map(([question = "", answer = ""]) => ({ question: question.trim(), answer: answer.trim() }))
    .filter((entry) => entry.question || entry.answer);
}

function normalizedMoney(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number.toFixed(2);
}

function normalizedInventory(value) {
  const text = String(value ?? "").trim();
  if (!text) return { value: 10, warning: null };
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
    return { value: 10, warning: "inventory_qty_invalid_defaulted_to_10" };
  }
  return { value: number, warning: null };
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function addIssue(product, level, code, message, field = null) {
  if (product.issues.some((issue) => issue.code === code && issue.field === field)) return;
  product.issues.push({ level, code, message, ...(field ? { field } : {}) });
}

function finalizeClassification(product) {
  if (product.issues.some((issue) => issue.level === "blocked")) product.status = "blocked";
  else if (product.issues.some((issue) => issue.level === "warning")) product.status = "warning";
  else product.status = "ready";
}

function addWarning(product, code, message, field = null) {
  addIssue(product, "warning", code, message, field);
}

function addBlocked(product, code, message, field = null) {
  addIssue(product, "blocked", code, message, field);
}

function buildProduct(record, fieldMap, { demoImages }) {
  const rowNumber = record.rowNumber;
  const title = trimmed(record, fieldMap, "title");
  const description = trimmed(record, fieldMap, "description");
  const productType = trimmed(record, fieldMap, "product_type");
  const sourceStatus = trimmed(record, fieldMap, "status");
  const handle = trimmed(record, fieldMap, "handle") || slugify(title) || `product-${rowNumber}`;
  const price = normalizedMoney(trimmed(record, fieldMap, "price"));
  const inventory = normalizedInventory(getCell(record, fieldMap, "inventory_qty"));
  let imageUrl = trimmed(record, fieldMap, "image_url");
  const compareAtPrice = normalizedMoney(trimmed(record, fieldMap, "compare_at_price"));
  const rawCompareAtPrice = trimmed(record, fieldMap, "compare_at_price");
  const tags = splitTags(getCell(record, fieldMap, "tags"));
  const faq = parseFaq(getCell(record, fieldMap, "faq"));

  const product = {
    row_number: rowNumber,
    handle,
    title,
    sku: trimmed(record, fieldMap, "sku"),
    price,
    status: "ready",
    source_status: sourceStatus || null,
    data: {
      handle,
      title,
      description,
      product_type: productType,
      vendor: trimmed(record, fieldMap, "vendor"),
      tags,
      price,
      compare_at_price: compareAtPrice,
      sku: trimmed(record, fieldMap, "sku"),
      inventory_qty: inventory.value,
      image_url: imageUrl,
      status: DEFAULT_STATUS,
      seo_title: trimmed(record, fieldMap, "seo_title"),
      seo_description: trimmed(record, fieldMap, "seo_description"),
      faq,
      brand: trimmed(record, fieldMap, "brand"),
      gtin: trimmed(record, fieldMap, "gtin"),
      mpn: trimmed(record, fieldMap, "mpn"),
      material: trimmed(record, fieldMap, "material"),
      color: trimmed(record, fieldMap, "color"),
      size: trimmed(record, fieldMap, "size"),
      google_product_category: trimmed(record, fieldMap, "google_product_category"),
      condition: trimmed(record, fieldMap, "condition") || "new",
    },
    issues: [],
    image_source: imageUrl ? "source" : "missing",
  };

  if (!title) addBlocked(product, "missing_title", "title is required", "title");
  if (!description) addBlocked(product, "missing_description", "description is required", "description");
  if (!productType) addBlocked(product, "missing_product_type", "product_type is required", "product_type");
  if (!product.data.sku) addBlocked(product, "missing_sku", "sku is required", "sku");
  if (!price) addBlocked(product, "invalid_price", "price must be a positive number", "price");
  if (rawCompareAtPrice && !compareAtPrice) {
    addWarning(product, "invalid_compare_at_price", "compare_at_price is not a valid positive number", "compare_at_price");
  } else if (compareAtPrice && price && Number(compareAtPrice) < Number(price)) {
    addWarning(product, "compare_at_price_below_price", "compare_at_price is lower than price", "compare_at_price");
  }
  if (inventory.warning) addWarning(product, inventory.warning, "inventory_qty is invalid and was defaulted to 10", "inventory_qty");

  if (!imageUrl) {
    if (demoImages) {
      imageUrl = SHOPIFY_PLACEHOLDER_IMAGE;
      product.data.image_url = imageUrl;
      product.image_source = "demo_placeholder";
      addWarning(product, "image_fallback_demo", "missing image_url replaced with a Shopify placeholder", "image_url");
    } else {
      addBlocked(product, "missing_image_url", "image_url is required unless --demo-images is enabled", "image_url");
    }
  } else if (!isHttpUrl(imageUrl)) {
    if (demoImages) {
      product.data.image_url = SHOPIFY_PLACEHOLDER_IMAGE;
      product.image_source = "demo_placeholder";
      addWarning(product, "image_fallback_demo", "invalid image_url replaced with a Shopify placeholder", "image_url");
    } else {
      addBlocked(product, "invalid_image_url", "image_url must be an http(s) URL", "image_url");
    }
  }

  if (sourceStatus && sourceStatus.toLowerCase() !== DEFAULT_STATUS) {
    addWarning(product, "status_forced_to_draft", `source status "${sourceStatus}" was forced to draft`, "status");
  }

  const warningChecks = [
    ["seo_title", "missing_seo_title"],
    ["seo_description", "missing_seo_description"],
    ["gtin", "missing_gtin"],
    ["material", "missing_material"],
    ["color", "missing_color"],
    ["size", "missing_size"],
  ];
  for (const [field, code] of warningChecks) {
    if (!String(product.data[field] ?? "").trim()) {
      addWarning(product, code, `${field} is recommended for GEO completeness`, field);
    }
  }
  if (faq.length === 0) addWarning(product, "missing_faq", "faq is recommended for GEO completeness", "faq");

  finalizeClassification(product);
  return product;
}

function markDuplicates(products) {
  const byHandle = new Map();
  const bySku = new Map();
  for (const product of products) {
    const handleKey = product.handle.toLowerCase();
    if (handleKey) {
      if (!byHandle.has(handleKey)) byHandle.set(handleKey, []);
      byHandle.get(handleKey).push(product);
    }
    const skuKey = product.data.sku.toLowerCase();
    if (skuKey) {
      if (!bySku.has(skuKey)) bySku.set(skuKey, []);
      bySku.get(skuKey).push(product);
    }
  }
  for (const group of byHandle.values()) {
    if (group.length > 1) {
      for (const product of group) addBlocked(product, "duplicate_handle", `duplicate handle "${product.handle}"`, "handle");
    }
  }
  for (const group of bySku.values()) {
    if (group.length > 1) {
      for (const product of group) addBlocked(product, "duplicate_sku", `duplicate SKU "${product.data.sku}"`, "sku");
    }
  }
  for (const product of products) finalizeClassification(product);
}

export async function probeImageUrl(url, { timeoutMs = 5000 } = {}) {
  const options = { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) };
  try {
    const response = await fetch(url, { ...options, method: "HEAD" });
    if (response.ok || (response.status >= 300 && response.status < 400)) return true;
  } catch {
    // Some CDNs reject HEAD. Try a tiny GET before declaring the URL bad.
  }
  try {
    const response = await fetch(url, { ...options, method: "GET", headers: { Range: "bytes=0-0" } });
    return response.ok || (response.status >= 300 && response.status < 400);
  } catch {
    return false;
  }
}

export async function parseProductsFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  let parsed;
  let format;
  if (extension === ".csv") {
    format = "csv";
    parsed = parseCsv(await fs.readFile(filePath, "utf8"));
  } else if (extension === ".xlsx") {
    format = "xlsx";
    parsed = await parseXlsx(filePath);
  } else {
    throw new Error(`Unsupported product file type "${extension || "(none)"}". Use .csv or .xlsx.`);
  }
  const { fieldMap, ignoredColumns } = mappingFromHeaders(parsed.headers);
  if (Object.keys(fieldMap).length === 0) {
    throw new Error("No recognized product columns found. Add headers such as title, price, sku, and image_url.");
  }
  const missingRequiredHeaders = REQUIRED_FIELDS.filter((field) => !fieldMap[field] && field !== "image_url");
  if (missingRequiredHeaders.length > 0) {
    throw new Error(`Missing required column(s): ${missingRequiredHeaders.join(", ")}`);
  }
  return {
    format,
    headers: parsed.headers,
    records: parsed.records,
    fieldMap,
    ignoredColumns,
  };
}

export async function buildPreview({
  filePath,
  demoImages = false,
  checkImages = false,
  dryRun = false,
  imageProbe = probeImageUrl,
}) {
  const parsed = await parseProductsFile(filePath);
  const products = parsed.records.map((record) => buildProduct(record, parsed.fieldMap, { demoImages }));

  if (checkImages) {
    for (const product of products) {
      if (product.status === "blocked" && !isHttpUrl(product.data.image_url)) continue;
      if (!isHttpUrl(product.data.image_url)) continue;
      const reachable = await imageProbe(product.data.image_url);
      if (!reachable) {
        if (demoImages) {
          product.data.image_url = SHOPIFY_PLACEHOLDER_IMAGE;
          product.image_source = "demo_placeholder";
          addWarning(product, "image_fallback_demo", "unreachable image_url replaced with a Shopify placeholder", "image_url");
        } else {
          addBlocked(product, "unreachable_image_url", "image_url is not reachable; rerun with --demo-images to use a Shopify placeholder", "image_url");
        }
      }
    }
  }

  markDuplicates(products);
  const counts = { ready: 0, warning: 0, blocked: 0 };
  for (const product of products) counts[product.status] += 1;

  return {
    schema_version: "1.0",
    artifact: "products.import.preview.json",
    generated_at: new Date().toISOString(),
    dry_run: Boolean(dryRun),
    source_file: filePath,
    source_format: parsed.format,
    default_status: DEFAULT_STATUS,
    shopify_status: DEFAULT_STATUS,
    channel_publish: false,
    field_map: parsed.fieldMap,
    ignored_columns: parsed.ignoredColumns,
    options: {
      demo_images: Boolean(demoImages),
      check_images: Boolean(checkImages),
    },
    total_rows: products.length,
    ready: counts.ready,
    warning: counts.warning,
    blocked: counts.blocked,
    importable: counts.ready + counts.warning,
    products,
  };
}
