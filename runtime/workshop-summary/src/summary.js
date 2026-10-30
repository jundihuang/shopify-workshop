import {
  AFTER_FILENAME,
  APPROVED_FILENAME,
  BEFORE_FILENAME,
  BRIEF_FILENAME,
  CHANNEL_FILENAME,
  CONNECTION_FILENAME,
  IMPORT_FILENAME,
  PROPOSAL_FILENAME,
  THEME_FILENAME,
} from "./paths.js";
import { safePreviewUrl } from "./load.js";

const EVIDENCE_MODES = new Set(["hybrid_admin_preview", "admin_only"]);
const THEME_OK = new Set(["unpublished", "fallback"]);

export const DIMENSIONS = Object.freeze([
  { key: "product_data_completeness", label: "Product Data Completeness", weight: "30%" },
  { key: "search_findability", label: "Search Findability", weight: "25%" },
  { key: "ai_understandability", label: "AI Understandability", weight: "20%" },
  { key: "purchase_trust", label: "Purchase Trust", weight: "15%" },
  { key: "technical_visibility", label: "Technical Visibility", weight: "10%" },
]);

const TAKEAWAYS = Object.freeze([
  "This store is a Preview Store created for the workshop. Preview Store is the only store path.",
  "The theme stays unpublished. Open it with the store open / access session. This summary does not include that session URL or an Opening soon password.",
  "GEO on this page is the workshop 5-dimension scorecard, not the full diagnostic.",
  "P0 copy is approved as one batch. A line-by-line review of every suggestion is not required. P1 stays collapsed.",
  "Import leaves products as Draft. Online Store channel is a separate confirmation. The theme is not published.",
]);

function text(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clip(value, max) {
  const clean = text(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

export function roundScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  if (rounded < 0 || rounded > 100) return null;
  return rounded;
}

export function gradeFor(score) {
  if (score === null || score === undefined) return null;
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

export function formatDelta(value) {
  if (value === null || value === undefined) return "—";
  if (value > 0) return `+${value}`;
  return String(value);
}

function fileBacked(source) {
  return source === "group" || source === "fixture";
}

function countFrom(doc, source, factsValue, field) {
  if (fileBacked(source) && doc) {
    if (Number.isFinite(Number(doc[field]))) return Math.max(0, Math.round(Number(doc[field])));
    if (field === "imported" && Array.isArray(doc.results)) return doc.results.length;
  }
  return Number.isInteger(factsValue) ? factsValue : null;
}

function channelStatusOf(channel, source, facts) {
  if (fileBacked(source) && channel) {
    if (channel.channel_status === "online_store_active" || channel.channel_status === "draft") {
      return channel.channel_status;
    }
  }
  if (facts.channelStatus === "online_store_active" || facts.channelStatus === "draft") {
    return facts.channelStatus;
  }
  return null;
}

function themeWasPublished(channel, theme) {
  if (channel?.theme_published === true || channel?.theme_publish_invoked === true) return true;
  if (theme?.theme_publish_invoked === true || theme?.live_theme_touched === true) return true;
  if (theme?.status && !["unpublished", "fallback", "none"].includes(theme.status)) return true;
  return false;
}

function themeView(theme, source, facts, store) {
  const fromFile = fileBacked(source) && theme;
  const status = fromFile && text(theme.status) ? text(theme.status) : facts.themeStatus;
  const themeId = fromFile && Number.isFinite(Number(theme.theme_id))
    ? Math.round(Number(theme.theme_id))
    : facts.themeId;
  const rawPreview = fromFile && text(theme.preview_url) ? text(theme.preview_url) : facts.previewUrl;
  const preview = safePreviewUrl(store, rawPreview) || (!store ? safePreviewUrl(null, rawPreview) : null);
  const fallback = fromFile ? Boolean(theme.fallback_used) : facts.fallbackUsed === "true";
  return {
    status: status || null,
    theme_id: Number.isInteger(themeId) && themeId > 0 ? themeId : null,
    preview_url: preview,
    fallback_used: fallback,
    withheld: Boolean(rawPreview) && !preview,
  };
}

function brandView(brief, source, facts) {
  if (!(fileBacked(source) && brief)) {
    const status = facts.brandStatus || null;
    return {
      present: status === "done" || status === "fallback_demo",
      brand_name: null,
      category: null,
      scene: null,
      status,
      selling_points: [],
    };
  }
  const sellingPoints = Array.isArray(brief.selling_points)
    ? brief.selling_points.map((item) => clip(item, 120)).filter(Boolean).slice(0, 4)
    : [];
  const brandName = clip(brief.brand_name, 80) || null;
  const category = clip(brief.category, 80) || null;
  return {
    present: Boolean(brandName || category || text(brief.positioning)),
    brand_name: brandName,
    category,
    scene: clip(brief.scene, 120) || null,
    status: facts.brandStatus || (source === "fixture" ? "fallback_demo" : "done"),
    selling_points: sellingPoints,
  };
}

function suggestionsOf(doc) {
  if (!Array.isArray(doc?.suggestions)) return [];
  return doc.suggestions.filter((item) => item && typeof item === "object");
}

function p0View(approved, proposal, sources, facts) {
  const approvedBacked = fileBacked(sources[APPROVED_FILENAME]);
  const approvedItems = approvedBacked
    ? suggestionsOf(approved).filter((item) => !item.priority || item.priority === "P0")
    : [];
  const proposalItems = fileBacked(sources[PROPOSAL_FILENAME]) ? suggestionsOf(proposal) : [];
  const fields = [];
  for (const item of approvedItems) {
    const field = text(item.field);
    if (field && !fields.includes(field)) fields.push(field);
  }
  const optimizer = facts.optimizerStatus || null;
  return {
    approved: approvedItems.length > 0 || optimizer === "approved_p0_batch" || optimizer === "applied",
    count: approvedItems.length,
    fields,
    p1_collapsed: proposalItems.filter((item) => item.priority === "P1").length,
    proposal_p0: proposalItems.filter((item) => item.priority === "P0").length,
    examples: approvedItems.slice(0, 3).map((item) => ({
      handle: clip(item.handle, 80),
      field: clip(item.field, 40),
      before: clip(item.before, 120),
      after: clip(item.after, 120),
    })),
    optimizer_status: optimizer,
  };
}

function scoreFrom(card, source, fallback) {
  if (fileBacked(source) && card) return roundScore(card.geo_score);
  return Number.isInteger(fallback) ? fallback : null;
}

function evidenceFrom(card) {
  return card && EVIDENCE_MODES.has(card.evidence_mode) ? card.evidence_mode : null;
}

function restrictionsFrom(before, after, facts) {
  const items = [
    ...(Array.isArray(before?.restrictions) ? before.restrictions : []),
    ...(Array.isArray(after?.restrictions) ? after.restrictions : []),
    ...(facts.restrictions || []),
  ];
  const unique = [];
  for (const item of items) {
    if (typeof item !== "string" || !/^[a-z0-9_]+$/.test(item) || unique.includes(item)) continue;
    unique.push(item);
  }
  return unique;
}

function topIssuesFrom(card, source) {
  if (!(fileBacked(source) && card) || !Array.isArray(card.top_issues)) return [];
  return card.top_issues.slice(0, 5).map((item) => ({
    priority: item?.priority === "P0" || item?.priority === "P1" || item?.priority === "P2" ? item.priority : "P2",
    issue: clip(item?.issue, 180),
    impact: clip(item?.impact, 180),
  })).filter((item) => item.issue);
}

function sampleCount(card, source) {
  if (!(fileBacked(source) && card) || !Array.isArray(card.products)) return null;
  return card.products.length;
}

function dimensionRows(before, beforeSource, after, afterSource) {
  return DIMENSIONS.map((dimension) => {
    const beforeScore = fileBacked(beforeSource) && before?.dimensions
      ? roundScore(before.dimensions[dimension.key])
      : null;
    const afterScore = fileBacked(afterSource) && after?.dimensions
      ? roundScore(after.dimensions[dimension.key])
      : null;
    return {
      key: dimension.key,
      label: dimension.label,
      weight: dimension.weight,
      before: beforeScore,
      after: afterScore,
      change: beforeScore === null || afterScore === null ? null : afterScore - beforeScore,
    };
  });
}

function checklistItem(id, label, checked, detail) {
  return { id, label, checked: Boolean(checked), detail: detail || "" };
}

/**
 * Build the summary document from a loaded bundle.
 * Scores are copied from shopify-geo-eval-workshop artifacts. This does not rescore.
 */
export function buildSummaryModel({ groupId, bundle }) {
  const sources = bundle.sources;
  const facts = bundle.facts;
  const imported = countFrom(bundle.importResult, sources[IMPORT_FILENAME], facts.imported, "imported");
  const failed = countFrom(bundle.importResult, sources[IMPORT_FILENAME], facts.failed, "failed");
  const channelStatus = channelStatusOf(bundle.channel, sources[CHANNEL_FILENAME], facts);
  const published = themeWasPublished(bundle.channel, bundle.theme);
  const theme = themeView(bundle.theme, sources[THEME_FILENAME], facts, bundle.store);
  const brand = brandView(bundle.brief, sources[BRIEF_FILENAME], facts);
  const p0 = p0View(bundle.approved, bundle.proposal, sources, facts);
  const before = scoreFrom(bundle.before, sources[BEFORE_FILENAME], facts.beforeScore);
  const after = scoreFrom(bundle.after, sources[AFTER_FILENAME], facts.afterScore);
  const improvement = before === null || after === null ? null : after - before;
  const evidence = evidenceFrom(bundle.after) || evidenceFrom(bundle.before) || (
    EVIDENCE_MODES.has(facts.evidenceMode) ? facts.evidenceMode : null
  );
  const issueCard = fileBacked(sources[AFTER_FILENAME]) && bundle.after ? bundle.after : bundle.before;
  const issueSource = fileBacked(sources[AFTER_FILENAME]) && bundle.after
    ? sources[AFTER_FILENAME]
    : sources[BEFORE_FILENAME];

  const products = {
    imported,
    failed,
    channel_status: channelStatus,
    theme_published: published,
  };
  const scores = {
    before,
    after,
    improvement,
    before_grade: gradeFor(before),
    after_grade: gradeFor(after),
    evidence_mode: evidence,
    restrictions: restrictionsFrom(bundle.before, bundle.after, facts),
    sample_before: sampleCount(bundle.before, sources[BEFORE_FILENAME]),
    sample_after: sampleCount(bundle.after, sources[AFTER_FILENAME]),
    dimensions: dimensionRows(bundle.before, sources[BEFORE_FILENAME], bundle.after, sources[AFTER_FILENAME]),
    top_issues: topIssuesFrom(issueCard, issueSource),
    top_issues_from: fileBacked(issueSource) && issueCard ? (issueCard === bundle.after ? "after" : "before") : null,
  };

  const checklist = [
    checklistItem(
      "preview_store",
      "Preview Store connected",
      Boolean(bundle.connection && bundle.store),
      bundle.store || "not connected",
    ),
    checklistItem(
      "products_imported",
      "Products imported",
      imported !== null && imported >= 5 && imported <= 10,
      imported === null ? "missing" : String(imported),
    ),
    checklistItem(
      "products_channel",
      "Online Store channel",
      channelStatus === "online_store_active" && !published,
      published ? "theme publish was recorded" : (channelStatus || "missing"),
    ),
    checklistItem(
      "theme_preview",
      "Unpublished theme preview",
      THEME_OK.has(theme.status) && Boolean(theme.preview_url) && !published,
      theme.preview_url || theme.status || "missing",
    ),
    checklistItem(
      "brand_brief",
      "Brand Brief",
      brand.present,
      brand.brand_name || brand.status || "missing",
    ),
    checklistItem("geo_before", "GEO before score", before !== null, before === null ? "missing" : String(before)),
    checklistItem("geo_after", "GEO after score", after !== null, after === null ? "missing" : String(after)),
    checklistItem(
      "p0_approved",
      "Approved P0 changes",
      p0.approved,
      p0.count > 0 ? `${p0.count} changes` : (p0.optimizer_status || "not approved"),
    ),
    checklistItem("workshop_summary", "Workshop Summary", true, "this page"),
  ];

  const gaps = [];
  const notes = [];
  for (const [filename, source] of Object.entries(sources)) {
    if (source === "missing") gaps.push(`${filename} is missing.`);
    if (source === "invalid") gaps.push(`${filename} could not be read.`);
  }
  for (const message of bundle.readErrors || []) gaps.push(message);
  if (bundle.fixtureFilled.length > 0) {
    notes.push(`Dry-run filled missing artifacts from fixtures: ${bundle.fixtureFilled.join(", ")}.`);
  }
  if (imported !== null && (imported < 5 || imported > 10)) {
    gaps.push(`Imported ${imported} products, outside the workshop target of 5–10.`);
  }
  if (channelStatus === "draft") gaps.push("Products are still draft. Online Store channel is not confirmed.");
  if (published) gaps.push("Theme must stay unpublished.");
  if (theme.withheld) {
    gaps.push("Unpublished preview link was withheld because it is not a preview_theme_id URL for this Preview Store.");
  }
  if (before !== null && after !== null && after < before) {
    gaps.push("GEO after score is lower than the before score on the same workshop scorecard.");
  }
  if (!p0.approved && p0.proposal_p0 > 0) {
    notes.push(`geo.proposal.json lists ${p0.proposal_p0} P0 suggestions that are not approved yet.`);
  }
  if (p0.approved && p0.count === 0) {
    notes.push("Approved P0 is recorded on workshop state, and geo.approved.json did not list suggestion rows.");
  }
  for (const [filename, card] of [[BEFORE_FILENAME, bundle.before], [AFTER_FILENAME, bundle.after]]) {
    if (sources[filename] === "group" && card?.store && bundle.store && card.store !== bundle.store) {
      gaps.push(`${filename} store (${card.store}) does not match the Preview Store (${bundle.store}).`);
    }
  }

  const session = bundle.connection?.storefront_session
    || (facts.storefrontSession === "access_url" || facts.storefrontSession === "none" ? facts.storefrontSession : null)
    || "none";

  return {
    ok: true,
    artifact: "workshop-summary.json",
    schema_version: "1.0",
    skill: "shopwright-workshop-orchestrator",
    step: "generate_workshop_summary",
    group_id: groupId,
    store: bundle.store,
    store_type: bundle.store ? "preview" : null,
    dry_run: Boolean(bundle.dryRun),
    shopify_called: false,
    theme_touched: false,
    products_touched: false,
    summary_status: bundle.dryRun ? "demo" : "done",
    fixture_filled: [...bundle.fixtureFilled],
    sources,
    checklist,
    checklist_complete: checklist.every((item) => item.checked),
    scores,
    products,
    theme: {
      status: theme.status,
      theme_id: theme.theme_id,
      preview_url: theme.preview_url,
      fallback_used: theme.fallback_used,
    },
    brand,
    p0,
    storefront_session: session,
    gaps,
    notes,
    takeaways: [...TAKEAWAYS],
  };
}

function cell(value) {
  return String(value ?? "—").replace(/\|/g, "/").replace(/\n/g, " ");
}

function check(item) {
  return `- [${item.checked ? "x" : " "}] ${item.label} — ${item.detail}`;
}

export function renderMarkdown(model) {
  const storeLine = model.store
    ? `Group **${cell(model.group_id)}** on Preview Store \`${cell(model.store)}\`.`
    : `Group **${cell(model.group_id)}**. Preview Store is not connected.`;
  const dimensionRows = model.scores.dimensions
    .map((row) => `| ${row.label} | ${row.weight} | ${cell(row.before)} | ${cell(row.after)} | ${formatDelta(row.change)} |`)
    .join("\n");
  const restrictionLines = model.scores.restrictions.length > 0
    ? model.scores.restrictions.map((item) => `- ${item}`).join("\n")
    : "- none recorded";
  const issueLines = model.scores.top_issues.length > 0
    ? model.scores.top_issues.map((item) => `- **${item.priority}** — ${item.issue} ${item.impact}`).join("\n")
    : "- none recorded";
  const exampleRows = model.p0.examples.length > 0
    ? model.p0.examples.map((item) => `| ${cell(item.handle)} | ${cell(item.field)} | ${cell(item.before)} | ${cell(item.after)} |`).join("\n")
    : "| — | — | — | — |";
  const sourceRows = Object.entries(model.sources)
    .map(([filename, source]) => `| ${filename} | ${source} |`)
    .join("\n");
  const gapLines = model.gaps.length > 0 ? model.gaps.map((item) => `- ${item}`).join("\n") : "- none";
  const noteLines = model.notes.length > 0 ? model.notes.map((item) => `- ${item}`).join("\n") : "- none";
  const takeawayLines = model.takeaways.map((item) => `- ${item}`).join("\n");
  const sellingPoints = model.brand.selling_points.length > 0
    ? model.brand.selling_points.map((item) => `- ${item}`).join("\n")
    : "- none recorded";
  const preview = model.theme.preview_url || "withheld";
  const beforeLabel = model.scores.before === null
    ? "—"
    : `${model.scores.before} (${model.scores.before_grade})`;
  const afterLabel = model.scores.after === null
    ? "—"
    : `${model.scores.after} (${model.scores.after_grade})`;

  return `# Workshop Summary

${storeLine}

This is a workshop scorecard, not the full diagnostic. Shopify was not called. Theme and products were not changed.

| | |
|---|---|
| Step | generate_workshop_summary |
| Status | ${model.summary_status} |
| Store type | ${model.store_type || "—"} |
| Storefront session | ${model.storefront_session} |
| Evidence | ${model.scores.evidence_mode || "—"} |

## Delivery checklist

${model.checklist.map(check).join("\n")}

## Scores

| | Before | After | Change |
|---|---:|---:|---:|
| GEO score | ${beforeLabel} | ${afterLabel} | ${formatDelta(model.scores.improvement)} |

Workshop sample: before ${cell(model.scores.sample_before)}, after ${cell(model.scores.sample_after)}.

### Workshop dimensions

| Dimension | Weight | Before | After | Change |
|---|---:|---:|---:|---:|
${dimensionRows}

### Restrictions

${restrictionLines}

### Top issues

${issueLines}

## Brand

| | |
|---|---|
| Name | ${cell(model.brand.brand_name)} |
| Category | ${cell(model.brand.category)} |
| Scene | ${cell(model.brand.scene)} |
| Brief status | ${cell(model.brand.status)} |

${sellingPoints}

## Theme

| | |
|---|---|
| Status | ${cell(model.theme.status)} |
| Theme id | ${cell(model.theme.theme_id)} |
| Preview | ${cell(preview)} |
| Fallback | ${model.theme.fallback_used ? "yes" : "no"} |

The theme stays unpublished.

## Products

| | |
|---|---|
| Imported | ${cell(model.products.imported)} |
| Failed | ${cell(model.products.failed)} |
| Channel | ${cell(model.products.channel_status)} |
| Theme published | ${model.products.theme_published ? "yes" : "no"} |

## Approved P0

${model.p0.approved ? "P0 changes are approved." : "P0 changes are not approved."}
Count: ${model.p0.count}. Fields: ${model.p0.fields.length > 0 ? model.p0.fields.join(", ") : "—"}.
P1 collapsed: ${model.p0.p1_collapsed}. Optimizer status: ${cell(model.p0.optimizer_status)}.

| Handle | Field | Before | After |
|---|---|---|---|
${exampleRows}

## Takeaways

${takeawayLines}

## Gaps

${gapLines}

## Notes

${noteLines}

## Sources

| Artifact | Source |
|---|---|
${sourceRows}

skill: shopwright-workshop-orchestrator
scorecard: shopify-geo-eval-workshop
`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlList(items) {
  if (items.length === 0) return "<p>None recorded.</p>";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function renderHtml(model) {
  const title = `Workshop Summary · Group ${model.group_id}`;
  const checks = model.checklist.map((item) => (
    `<li class="${item.checked ? "ok" : "gap"}"><span>${item.checked ? "✓" : "·"}</span> ${escapeHtml(item.label)} <em>${escapeHtml(item.detail)}</em></li>`
  )).join("");
  const dimensions = model.scores.dimensions.map((row) => (
    `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.weight)}</td><td>${escapeHtml(row.before ?? "—")}</td><td>${escapeHtml(row.after ?? "—")}</td><td>${escapeHtml(formatDelta(row.change))}</td></tr>`
  )).join("");
  const examples = model.p0.examples.length > 0
    ? model.p0.examples.map((item) => (
      `<tr><td>${escapeHtml(item.handle)}</td><td>${escapeHtml(item.field)}</td><td>${escapeHtml(item.before)}</td><td>${escapeHtml(item.after)}</td></tr>`
    )).join("")
    : "<tr><td colspan=\"4\">No approved rows recorded.</td></tr>";
  const issues = model.scores.top_issues.length > 0
    ? `<ul>${model.scores.top_issues.map((item) => `<li><strong>${escapeHtml(item.priority)}</strong> ${escapeHtml(item.issue)} ${escapeHtml(item.impact)}</li>`).join("")}</ul>`
    : "<p>None recorded.</p>";
  const preview = model.theme.preview_url
    ? `<a href="${escapeHtml(model.theme.preview_url)}">${escapeHtml(model.theme.preview_url)}</a>`
    : "withheld";
  const beforeLabel = model.scores.before === null ? "—" : `${model.scores.before} (${model.scores.before_grade})`;
  const afterLabel = model.scores.after === null ? "—" : `${model.scores.after} (${model.scores.after_grade})`;
  const storeLine = model.store
    ? `Group ${escapeHtml(model.group_id)} on Preview Store <code>${escapeHtml(model.store)}</code>.`
    : `Group ${escapeHtml(model.group_id)}. Preview Store is not connected.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font: 16px/1.5 "Iowan Old Style", Palatino, Georgia, serif; background: #f4f0e8; color: #1c2430; }
    main { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { font-size: 2rem; line-height: 1.15; margin: 0 0 8px; }
    h2 { font-size: 1.25rem; margin: 2rem 0 0.6rem; }
    p.lede { margin-top: 0; }
    .banner { background: #1f4e5f; color: #f7f4ee; padding: 8px 12px; display: inline-block; letter-spacing: 0.04em; text-transform: uppercase; font: 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
    .scores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0 20px; }
    .score { background: white; border: 1px solid #ddd4c4; padding: 12px; }
    .score b { display: block; font-size: 1.6rem; }
    table { width: 100%; border-collapse: collapse; background: white; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eadfce; vertical-align: top; }
    th { font: 12px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.03em; text-transform: uppercase; }
    ul.checks { list-style: none; padding: 0; }
    ul.checks li { background: white; margin: 0 0 6px; padding: 8px 10px; border: 1px solid #eadfce; }
    ul.checks .ok span { color: #1f4e5f; }
    ul.checks .gap { border-color: #e2b4a2; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
    a { color: #1f4e5f; }
    footer { margin-top: 28px; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; color: #5c6570; }
  </style>
</head>
<body>
<main>
  <p class="banner">ShopWright Workshop</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">${storeLine} This is a workshop scorecard, not the full diagnostic. Shopify was not called.</p>
  <section class="scores" aria-label="Score comparison">
    <div class="score"><span>Before</span><b>${escapeHtml(beforeLabel)}</b></div>
    <div class="score"><span>After</span><b>${escapeHtml(afterLabel)}</b></div>
    <div class="score"><span>Change</span><b>${escapeHtml(formatDelta(model.scores.improvement))}</b></div>
  </section>
  <h2>Delivery checklist</h2>
  <ul class="checks">${checks}</ul>
  <h2>Workshop dimensions</h2>
  <table>
    <thead><tr><th>Dimension</th><th>Weight</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
    <tbody>${dimensions}</tbody>
  </table>
  <h2>Top issues</h2>
  ${issues}
  <h2>Brand</h2>
  <p>${escapeHtml(model.brand.brand_name || "Brand name missing")} · ${escapeHtml(model.brand.category || "category missing")}</p>
  ${htmlList(model.brand.selling_points)}
  <h2>Theme</h2>
  <p>Status ${escapeHtml(model.theme.status || "missing")}. Fallback ${model.theme.fallback_used ? "yes" : "no"}. Preview ${preview}.</p>
  <p>The theme stays unpublished.</p>
  <h2>Products</h2>
  <p>Imported ${escapeHtml(model.products.imported ?? "—")}. Failed ${escapeHtml(model.products.failed ?? "—")}. Channel ${escapeHtml(model.products.channel_status || "missing")}. Theme published ${model.products.theme_published ? "yes" : "no"}.</p>
  <h2>Approved P0</h2>
  <p>${model.p0.approved ? "P0 changes are approved." : "P0 changes are not approved."} Count ${escapeHtml(model.p0.count)}. P1 collapsed ${escapeHtml(model.p0.p1_collapsed)}.</p>
  <table>
    <thead><tr><th>Handle</th><th>Field</th><th>Before</th><th>After</th></tr></thead>
    <tbody>${examples}</tbody>
  </table>
  <h2>Takeaways</h2>
  ${htmlList(model.takeaways)}
  <h2>Gaps</h2>
  ${htmlList(model.gaps)}
  <h2>Notes</h2>
  ${htmlList(model.notes)}
  <footer>
    <p>skill: shopwright-workshop-orchestrator · step: generate_workshop_summary · scorecard: shopify-geo-eval-workshop</p>
    <p>Storefront session handle: ${escapeHtml(model.storefront_session)}. Evidence: ${escapeHtml(model.scores.evidence_mode || "—")}.</p>
  </footer>
</main>
</body>
</html>
`;
}
