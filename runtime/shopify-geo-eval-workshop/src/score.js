import { SAMPLE_LIMIT } from "./paths.js";

/**
 * Workshop-only scorecard heuristics.
 * Checks Admin title, description, media, and SEO fields, then applies the
 * published 5-dimension weights. This is a workshop scorecard, not the full diagnostic.
 */

export const DIMENSION_KEYS = Object.freeze([
  "product_data_completeness",
  "search_findability",
  "ai_understandability",
  "purchase_trust",
  "technical_visibility",
]);

export const WEIGHTS = Object.freeze({
  product_data_completeness: 0.3,
  search_findability: 0.25,
  ai_understandability: 0.2,
  purchase_trust: 0.15,
  technical_visibility: 0.1,
});

export const TECHNICAL_CAP_ADMIN = 40;
export const TECHNICAL_CAP_SCHEMA = 55;

const ISSUE_SENTENCE = Object.freeze({
  title_short: "Title is missing or too short.",
  description_thin: "Description is missing or too thin.",
  seo_incomplete: "SEO title or description is missing.",
  image_missing: "No product media is attached.",
  faq_missing: "FAQ or trust copy is missing.",
});

export function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function gradeFor(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "D";
  if (value >= 90) return "A+";
  if (value >= 80) return "A";
  if (value >= 70) return "B";
  if (value >= 60) return "C";
  return "D";
}

export function weightedScore(dimensions) {
  const total = DIMENSION_KEYS.reduce((sum, key) => sum + Number(dimensions[key] || 0) * WEIGHTS[key], 0);
  return clampScore(total);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function plain(value) {
  return text(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.nodes)) return value.nodes;
  return [];
}

export function normalizeProduct(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const seo = raw.seo && typeof raw.seo === "object" ? raw.seo : {};
  const media = [];
  for (const item of asArray(raw.media)) {
    if (!item || typeof item !== "object") continue;
    const url = item.url || item.image?.url || item.preview?.image?.url || "";
    const alt = item.alt || item.altText || item.image?.altText || "";
    if (url || alt) media.push({ url: String(url), alt: String(alt || "") });
  }
  if (media.length === 0 && raw.featuredMedia && typeof raw.featuredMedia === "object") {
    const url = raw.featuredMedia.preview?.image?.url || raw.featuredMedia.url || "";
    const alt = raw.featuredMedia.alt || "";
    if (url || alt) media.push({ url: String(url), alt: String(alt || "") });
  }
  const variants = asArray(raw.variants)
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      sku: item.sku == null ? "" : String(item.sku),
      price: item.price == null ? "" : String(item.price),
    }));
  const options = asArray(raw.options).filter((item) => item && typeof item === "object" && (item.name || asArray(item.values).length > 0));
  let faq = "";
  if (typeof raw.faq === "string") faq = raw.faq;
  else if (Array.isArray(raw.faq)) {
    faq = raw.faq
      .map((item) => (typeof item === "string" ? item : `${item?.q || ""} ${item?.a || ""}`))
      .join(" ");
  }
  if (!text(faq)) {
    const faqField = asArray(raw.metafields).find((item) => item && /faq/i.test(`${item.namespace || ""} ${item.key || ""}`));
    if (faqField?.value) faq = String(faqField.value);
  }
  let tags = [];
  if (Array.isArray(raw.tags)) tags = raw.tags.map((item) => String(item).trim()).filter(Boolean);
  else if (typeof raw.tags === "string") tags = raw.tags.split(",").map((item) => item.trim()).filter(Boolean);

  return {
    handle: text(raw.handle),
    title: text(raw.title),
    description: plain(raw.description) || plain(raw.descriptionHtml),
    productType: text(raw.productType || raw.product_type),
    vendor: text(raw.vendor),
    status: text(raw.status),
    tags,
    seo: {
      title: text(seo.title || raw.seo_title),
      description: text(seo.description || raw.seo_description),
    },
    media,
    options,
    variants,
    faq: plain(faq),
  };
}

export function prepareSample(rawProducts) {
  const list = Array.isArray(rawProducts) ? rawProducts : [];
  const normalized = [];
  list.forEach((raw, index) => {
    const product = normalizeProduct(raw);
    if (!product) return;
    if (!product.handle) product.handle = `untitled-${index + 1}`;
    if (!product.title && !product.description && product.handle.startsWith("untitled-")) return;
    normalized.push(product);
  });
  return {
    total: normalized.length,
    capped: normalized.length > SAMPLE_LIMIT,
    products: normalized.slice(0, SAMPLE_LIMIT),
  };
}

function hasQuestion(value) {
  return /\?/.test(value);
}

function trustSignal(description, faq) {
  return /\b(cotton|material|shipping|returns?|warranty|care)\b/i.test(`${description} ${faq}`);
}

export function scoreProduct(product, html = null) {
  const title = text(product.title);
  const description = text(product.description);
  const productType = text(product.productType);
  const vendor = text(product.vendor);
  const handle = text(product.handle);
  const seoTitle = text(product.seo?.title);
  const seoDescription = text(product.seo?.description);
  const tags = Array.isArray(product.tags) ? product.tags : [];
  const options = Array.isArray(product.options) ? product.options : [];
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const media = Array.isArray(product.media) ? product.media : [];
  const faq = text(product.faq);
  const sku = variants.some((item) => text(item.sku));
  const price = variants.some((item) => text(item.price));
  const image = media.some((item) => text(item.url));
  const alt = media.some((item) => text(item.alt));
  const htmlChecked = Boolean(html && html.checked && !html.opening_soon);
  const schemaPresent = Boolean(htmlChecked && html.schema_present);

  let completeness = 0;
  if (title.length >= 12) completeness += 30;
  else if (title) completeness += 12;
  if (description.length >= 120) completeness += 30;
  else if (description.length >= 40) completeness += 18;
  else if (description) completeness += 8;
  if (image && alt) completeness += 25;
  else if (image) completeness += 15;
  if (productType) completeness += 5;
  if (vendor) completeness += 5;
  if (sku || options.length > 0 || tags.length > 0) completeness += 5;

  let findability = 0;
  if (seoTitle.length >= 20 && seoTitle.length <= 70) findability += 40;
  else if (seoTitle) findability += 25;
  else if (title.length >= 12) findability += 15;
  if (seoDescription.length >= 50 && seoDescription.length <= 180) findability += 40;
  else if (seoDescription) findability += 25;
  if (handle.includes("-")) findability += 10;
  else if (handle) findability += 4;
  if (productType || tags.length > 0) findability += 10;

  let ai = 0;
  if (description.length >= 80) ai += 40;
  else if (description.length >= 40) ai += 20;
  else if (description) ai += 8;
  const factBits = [vendor, productType, sku ? "sku" : ""].filter(Boolean).length;
  if (factBits >= 3) ai += 35;
  else if (factBits === 2) ai += 22;
  else if (factBits === 1) ai += 10;
  if (schemaPresent) ai += 25;

  let trust = 0;
  if (vendor) trust += 25;
  if (price) trust += 25;
  if (faq || hasQuestion(description)) trust += 30;
  if (trustSignal(description, faq)) trust += 20;

  const missing = [];
  if (title.length < 12) missing.push("title");
  if (description.length < 40) missing.push("description");
  if (!image) missing.push("image");
  else if (!alt) missing.push("image_alt");
  if (!seoTitle) missing.push("seo_title");
  if (!seoDescription) missing.push("seo_description");
  if (!productType && !vendor && !sku && options.length === 0 && tags.length === 0) missing.push("attributes");
  if (!faq && !hasQuestion(description)) missing.push("faq");

  const issueCodes = [];
  if (title.length < 12) issueCodes.push("title_short");
  if (description.length < 40) issueCodes.push("description_thin");
  if (!seoTitle || !seoDescription) issueCodes.push("seo_incomplete");
  if (!image) issueCodes.push("image_missing");
  if (missing.includes("faq")) issueCodes.push("faq_missing");

  let priority = "P2";
  if (issueCodes.some((code) => code === "title_short" || code === "description_thin" || code === "seo_incomplete")) {
    priority = "P0";
  } else if (issueCodes.some((code) => code === "image_missing" || code === "faq_missing")) {
    priority = "P1";
  }

  let seoStatus = "missing";
  if (seoTitle && seoDescription) seoStatus = "present";
  else if (seoTitle || seoDescription || title.length >= 12) seoStatus = "partial";

  let schemaStatus = "not_checked";
  if (htmlChecked) schemaStatus = schemaPresent ? "present" : "missing";

  let aiStatus = "missing";
  if (description.length >= 80 && (vendor || productType)) aiStatus = "clear";
  else if (description) aiStatus = "thin";

  const titlePts = title.length >= 12 ? 20 : title ? 10 : 0;
  const descPts = description.length >= 80 ? 20 : description.length >= 40 ? 12 : description ? 6 : 0;
  const attrPts = (productType ? 7 : 0) + (vendor ? 7 : 0) + (sku || options.length > 0 || tags.length > 0 ? 6 : 0);
  const seoPts = (seoTitle ? 8 : title.length >= 12 ? 3 : 0) + (seoDescription ? 7 : 0);
  const faqPts = (faq || hasQuestion(description) ? 6 : 0) + (price ? 4 : 0);
  const schemaPts = schemaPresent ? 10 : 0;
  const imagePts = (image ? 3 : 0) + (alt ? 2 : 0);

  return {
    handle,
    score: clampScore(titlePts + descPts + attrPts + seoPts + faqPts + schemaPts + imagePts),
    issues: issueCodes.map((code) => ISSUE_SENTENCE[code]),
    issue_codes: issueCodes,
    priority,
    missing_fields: missing,
    schema_status: schemaStatus,
    seo_status: seoStatus,
    ai_readability_status: aiStatus,
    dimensions: {
      product_data_completeness: clampScore(completeness),
      search_findability: clampScore(findability),
      ai_understandability: clampScore(ai),
      purchase_trust: clampScore(trust),
    },
  };
}

export function averageDimensions(scoredProducts, technical) {
  const dimensions = {};
  for (const key of DIMENSION_KEYS) {
    if (key === "technical_visibility") {
      dimensions[key] = clampScore(technical);
      continue;
    }
    const values = scoredProducts.map((product) => product.dimensions[key]);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    dimensions[key] = clampScore(mean);
  }
  return dimensions;
}
