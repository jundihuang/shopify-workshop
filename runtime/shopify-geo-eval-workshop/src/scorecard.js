import { SAMPLE_LIMIT } from "./paths.js";
import { assertNoSensitiveKeys } from "./redact.js";
import {
  TECHNICAL_CAP_ADMIN,
  TECHNICAL_CAP_SCHEMA,
  averageDimensions,
  gradeFor,
  prepareSample,
  scoreProduct,
  weightedScore,
} from "./score.js";

const TOP_ISSUE_COPY = Object.freeze({
  title_short: {
    issue: "Some product titles are missing or too short.",
    impact: "The item is harder to identify in search and in an assistant answer.",
    priority: "P0",
  },
  description_thin: {
    issue: "Some descriptions are missing or too thin.",
    impact: "Shoppers and assistants lack enough product facts to understand the item.",
    priority: "P0",
  },
  seo_incomplete: {
    issue: "SEO title or description is missing on sampled products.",
    impact: "Search snippets fall back to thin or empty fields.",
    priority: "P0",
  },
  image_missing: {
    issue: "One or more sampled products have no media.",
    impact: "The product is harder to recognize on a listing or preview page.",
    priority: "P1",
  },
  faq_missing: {
    issue: "FAQ or trust copy is missing on sampled products.",
    impact: "Purchase questions are left to the title and a short description.",
    priority: "P1",
  },
});

const RESTRICTION_ORDER = Object.freeze([
  "channel_not_online_store",
  "html_evidence_skipped",
  "storefront_session_missing",
  "access_url_rate_limited",
  "html_evidence_unavailable",
  "unauthenticated_storefront_restricted",
  "sample_capped_at_10",
]);

function uniqueRestrictions(restrictions) {
  const seen = new Set();
  const ordered = [];
  const ranked = [...restrictions].sort((left, right) => {
    const leftRank = RESTRICTION_ORDER.indexOf(left);
    const rightRank = RESTRICTION_ORDER.indexOf(right);
    return (leftRank === -1 ? 99 : leftRank) - (rightRank === -1 ? 99 : rightRank);
  });
  for (const item of ranked) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    ordered.push(item);
  }
  return ordered;
}

function publicProduct(product) {
  return {
    handle: product.handle,
    score: product.score,
    issues: product.issues,
    priority: product.priority,
    missing_fields: product.missing_fields,
    schema_status: product.schema_status,
    seo_status: product.seo_status,
    ai_readability_status: product.ai_readability_status,
  };
}

function buildTopIssues(scoredProducts, { htmlUsed, channelReady }) {
  const present = new Set(scoredProducts.flatMap((product) => product.issue_codes));
  const items = [];
  for (const code of ["title_short", "description_thin", "seo_incomplete", "image_missing", "faq_missing"]) {
    if (present.has(code)) items.push({ ...TOP_ISSUE_COPY[code] });
  }
  if (!channelReady) {
    items.push({
      issue: "Products are not confirmed Active on the Online Store channel.",
      impact: "This pass is an Admin precheck, not a full storefront score.",
      priority: "P1",
    });
  }
  if (!htmlUsed) {
    items.push({
      issue: "Storefront HTML was not read for this scorecard.",
      impact: "Search, AI, and Trust use the Admin fields that are available.",
      priority: "P2",
    });
  }
  items.push({
    issue: "Unauthenticated Preview Store endpoints are restricted.",
    impact: "Technical visibility is capped. This scorecard does not treat robots, products.json, or sitemap as a successful storefront read.",
    priority: "P2",
  });
  const rank = { P0: 0, P1: 1, P2: 2 };
  items.sort((left, right) => rank[left.priority] - rank[right.priority]);
  return items;
}

export function safePreviewUrl(store, previewUrl) {
  if (typeof previewUrl !== "string" || typeof store !== "string") return undefined;
  const escaped = store.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^https://${escaped}/\\?preview_theme_id=\\d+$`);
  return pattern.test(previewUrl) ? previewUrl : undefined;
}

/**
 * Build a scorecard object that matches templates/geo-score.schema.json.
 * htmlByHandle values are in-memory page notes. They must not carry URLs.
 */
export function buildScorecard({
  store,
  previewUrl,
  products,
  htmlByHandle = {},
  restrictions = [],
  htmlSkipped = false,
  channelReady = true,
}) {
  const sample = prepareSample(products);
  if (sample.products.length === 0) {
    throw new Error("No products to score. Import products before running workshop GEO.");
  }
  const htmlNotes = htmlByHandle && typeof htmlByHandle === "object" ? htmlByHandle : {};
  const scored = sample.products.map((product) => scoreProduct(product, htmlNotes[product.handle] || null));
  const htmlUsed = scored.some((product) => product.schema_status !== "not_checked");
  const schemaSeen = scored.some((product) => product.schema_status === "present");
  const technical = schemaSeen ? TECHNICAL_CAP_SCHEMA : TECHNICAL_CAP_ADMIN;
  const dimensions = averageDimensions(scored, technical);
  const geoScore = weightedScore(dimensions);

  let nextRestrictions = [...restrictions];
  if (sample.capped && !nextRestrictions.includes("sample_capped_at_10")) {
    nextRestrictions.push("sample_capped_at_10");
  }
  if (!channelReady && !nextRestrictions.includes("channel_not_online_store")) {
    nextRestrictions.push("channel_not_online_store");
  }
  if (htmlUsed) {
    nextRestrictions = nextRestrictions.filter((item) => item !== "html_evidence_skipped");
  } else if (htmlSkipped && !nextRestrictions.includes("html_evidence_skipped")) {
    nextRestrictions.push("html_evidence_skipped");
  }
  if (!nextRestrictions.includes("unauthenticated_storefront_restricted")) {
    nextRestrictions.push("unauthenticated_storefront_restricted");
  }

  const scorecard = {
    store,
    geo_score: geoScore,
    grade: gradeFor(geoScore),
    evidence_mode: htmlUsed ? "hybrid_admin_preview" : "admin_only",
    restrictions: uniqueRestrictions(nextRestrictions),
    dimensions,
    top_issues: buildTopIssues(scored, { htmlUsed, channelReady }),
    products: scored.map(publicProduct),
    skill: "shopify-geo-eval-workshop",
  };
  const safePreview = safePreviewUrl(store, previewUrl);
  if (safePreview) scorecard.preview_url = safePreview;
  assertNoSensitiveKeys(scorecard, "scorecard");
  if (scorecard.products.length > SAMPLE_LIMIT) {
    throw new Error("Refusing to write a scorecard with more than 10 products");
  }
  return scorecard;
}

function cell(value) {
  return String(value ?? "").replace(/\|/g, "/");
}

export function renderScoreMarkdown(scorecard) {
  const weights = {
    product_data_completeness: "30%",
    search_findability: "25%",
    ai_understandability: "20%",
    purchase_trust: "15%",
    technical_visibility: "10%",
  };
  const labels = {
    product_data_completeness: "Product Data Completeness",
    search_findability: "Search Findability",
    ai_understandability: "AI Understandability",
    purchase_trust: "Purchase Trust",
    technical_visibility: "Technical Visibility",
  };
  const dimensionRows = Object.keys(labels)
    .map((key) => `| ${labels[key]} | ${scorecard.dimensions[key]} | ${weights[key]} |`)
    .join("\n");
  const restrictionLines = (scorecard.restrictions || []).map((item) => `- ${item}`).join("\n") || "- none";
  const issueLines = (scorecard.top_issues || [])
    .map((item) => `- **${item.priority}** — ${item.issue} ${item.impact}`)
    .join("\n");
  const productRows = (scorecard.products || [])
    .map((product) => `| ${cell(product.handle)} | ${product.score} | ${product.priority} | ${product.seo_status} | ${product.schema_status} |`)
    .join("\n");
  return `# Workshop GEO scorecard

This is a workshop scorecard, not the full diagnostic.

| | |
|---|---|
| Store | ${cell(scorecard.store)} |
| Score | **${scorecard.geo_score}** (${scorecard.grade}) |
| Evidence | ${scorecard.evidence_mode} |
| Sample | ${scorecard.products.length} / ${SAMPLE_LIMIT} |
| Preview | ${scorecard.preview_url || "—"} |

## Dimensions

| Dimension | Score | Weight |
|---|---:|---:|
${dimensionRows}

## Restrictions

${restrictionLines}

## Top issues

${issueLines}

## Products

| Handle | Score | Priority | SEO | Schema |
|---|---:|---|---|---|
${productRows}

skill: shopify-geo-eval-workshop
`;
}
