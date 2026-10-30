import { loadGeoScoreSchema, validateGeoScore } from "../../shopify-geo-eval-workshop/src/schema.js";
import { fieldCopies, readConstraints } from "./copy.js";
import { P0_FIELDS } from "./paths.js";
import { assertNoSensitiveKeys } from "./redact.js";

const IMPACT = Object.freeze({
  title: "Search Findability on the workshop scorecard",
  description: "Product Data Completeness and AI Understandability on the workshop scorecard",
  meta_title: "Search Findability on the workshop scorecard",
  meta_description: "Search Findability on the workshop scorecard",
  key_attributes: "Product Data Completeness on the workshop scorecard",
  faq: "Purchase Trust on the workshop scorecard",
  image_alt: "Product Data Completeness on the workshop scorecard",
});

const REASONS = Object.freeze({
  title: "Workshop scorecard: title is missing or too short.",
  description: "Workshop scorecard: description is missing or too thin.",
  meta_title: "Workshop scorecard: SEO title is missing. Meta title target is about 60 characters.",
  meta_description: "Workshop scorecard: SEO description is missing. Meta description target is about 150 characters.",
  key_attributes: "Workshop scorecard: key attributes are missing. Fill category, selling point, and scene from the brand brief.",
  faq: "Workshop scorecard: FAQ is missing. Collapsed P1; skip it unless you deep-review this product.",
  image_alt: "Workshop scorecard: image alt is missing. Collapsed P1; skip it unless you deep-review this product.",
});

const ISSUE_HINTS = Object.freeze({
  title: /title is missing or too short/i,
  description: /description is missing or too thin/i,
  meta_title: /SEO title or description is missing/i,
  meta_description: /SEO title or description is missing/i,
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeFields(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const seo = source.seo && typeof source.seo === "object" ? source.seo : {};
  return {
    title: text(source.title),
    description: text(source.description),
    meta_title: text(source.meta_title ?? source.seo_title ?? seo.title),
    meta_description: text(source.meta_description ?? source.seo_description ?? seo.description),
    key_attributes: text(source.key_attributes ?? source.product_type ?? source.productType),
    tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
  };
}

export function fieldsKnownFor(product, extraFields) {
  if (product.fields && typeof product.fields === "object" && !Array.isArray(product.fields)) {
    return product.fields;
  }
  if (extraFields && typeof extraFields.get === "function" && extraFields.has(product.handle)) {
    return extraFields.get(product.handle);
  }
  return null;
}

function weakP0Fields(product, fields, known) {
  const missing = new Set(Array.isArray(product.missing_fields) ? product.missing_fields : []);
  const issues = (product.issues || []).join(" ");
  const seoStatus = text(product.seo_status);
  const selected = [];

  if (missing.has("title") || ISSUE_HINTS.title.test(issues) || (known && fields.title.length < 12)) {
    selected.push("title");
  }
  if (missing.has("description") || ISSUE_HINTS.description.test(issues) || (known && fields.description.length < 40)) {
    selected.push("description");
  }

  const seoGap = seoStatus === "missing" || seoStatus === "partial" || ISSUE_HINTS.meta_title.test(issues);
  if (missing.has("seo_title") || (seoGap && (!known || !fields.meta_title))) selected.push("meta_title");
  if (missing.has("seo_description") || (seoGap && (!known || !fields.meta_description))) {
    selected.push("meta_description");
  }
  if (missing.has("attributes") || (known && !fields.key_attributes)) selected.push("key_attributes");

  return selected;
}

function weakP1Fields(product) {
  const missing = new Set(Array.isArray(product.missing_fields) ? product.missing_fields : []);
  const issues = (product.issues || []).join(" ");
  const selected = [];
  if (missing.has("faq") || /FAQ or trust copy is missing/i.test(issues)) selected.push("faq");
  if (missing.has("image_alt")) selected.push("image_alt");
  return selected;
}

function confidenceFor(before) {
  if (!before || before.length < 12) return "high";
  if (before.length < 40) return "medium";
  return "low";
}

function suggestionFor(product, field, fields, copies, priority) {
  const before = fields[field] || "";
  const after = copies[field];
  if (!after) {
    throw new Error(`No after text for ${product.handle} ${field}`);
  }
  return {
    handle: product.handle,
    field,
    before,
    after,
    reason: REASONS[field],
    expected_impact: IMPACT[field],
    priority,
    confidence: confidenceFor(before),
    batch: priority === "P0",
    collapsed: priority !== "P0",
  };
}

export async function assertWorkshopScorecard(scorecard) {
  const schema = await loadGeoScoreSchema();
  const errors = validateGeoScore(scorecard, schema);
  if (errors.length > 0) {
    throw new Error(
      `Refusing a scorecard that is not from shopify-geo-eval-workshop: ${errors.map((entry) => entry.message).join("; ")}`,
    );
  }
  assertNoSensitiveKeys(scorecard, "scorecard");
  return scorecard;
}

export function buildProposal({ scorecard, brief, groupId, extraFields = new Map() }) {
  if (!scorecard || !Array.isArray(scorecard.products) || scorecard.products.length === 0) {
    throw new Error("No products in the workshop scorecard.");
  }
  if (scorecard.products.length > 10) {
    throw new Error("Refusing a workshop scorecard with more than 10 products.");
  }
  const constraints = readConstraints(brief);
  const suggestions = [];

  for (const product of scorecard.products) {
    if (!product || typeof product.handle !== "string" || !product.handle.trim()) {
      throw new Error("Each workshop scorecard product needs a handle.");
    }
    const raw = fieldsKnownFor(product, extraFields);
    const known = Boolean(raw);
    const fields = normalizeFields(raw);
    const copies = fieldCopies({ handle: product.handle, constraints });
    const productSuggestions = [
      ...weakP0Fields(product, fields, known).map((field) => suggestionFor(product, field, fields, copies, "P0")),
      ...weakP1Fields(product).map((field) => suggestionFor(product, field, fields, copies, "P1")),
    ];
    const p0 = productSuggestions.filter((item) => item.priority === "P0");
    const p1 = productSuggestions.filter((item) => item.priority === "P1");
    suggestions.push(...[...p0, ...p1].slice(0, 8));
  }

  for (const item of suggestions) {
    if (!P0_FIELDS.includes(item.field) && item.priority === "P0") {
      throw new Error(`P0 suggestion used an unsupported field ${item.field}`);
    }
  }

  return {
    ok: true,
    artifact: "geo.proposal.json",
    schema_version: "1.0",
    skill: "shopify-geo-optimizer",
    source_skill: "shopify-geo-eval-workshop",
    group_id: groupId,
    store: scorecard.store,
    store_type: "preview",
    before_score: scorecard.geo_score,
    ux: {
      default_action: "approve_all_p0",
      deep_review_max_products: 2,
      p1: "collapsed",
      line_by_line_review: false,
    },
    constraints: {
      category: constraints.category,
      scene: constraints.scene,
      selling_points: constraints.sellingPoints,
    },
    counts: {
      products: scorecard.products.length,
      suggestions: suggestions.length,
      p0: suggestions.filter((item) => item.priority === "P0").length,
      p1: suggestions.filter((item) => item.priority === "P1").length,
    },
    suggestions,
  };
}

export function extraFieldsFromPreview(preview) {
  const index = new Map();
  const products = Array.isArray(preview?.products) ? preview.products : [];
  for (const product of products) {
    const data = product?.data && typeof product.data === "object" ? product.data : product;
    const handle = product?.handle || data?.handle;
    if (!handle || index.has(handle)) continue;
    index.set(handle, data);
  }
  return index;
}
