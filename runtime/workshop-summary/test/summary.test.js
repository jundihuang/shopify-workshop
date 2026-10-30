import test from "node:test";
import assert from "node:assert/strict";
import { buildSummaryModel, formatDelta, gradeFor, renderHtml, renderMarkdown } from "../src/summary.js";

function bundle(overrides = {}) {
  return {
    dryRun: false,
    store: "group-a.myshopify.com",
    connection: {
      store: "group-a.myshopify.com",
      store_type: "preview",
      auth: "cli_cached_admin_token",
      scopes_ok: true,
      storefront_session: "access_url",
    },
    guardSecrets: [],
    facts: {
      storeDomain: "group-a.myshopify.com",
      storeType: "preview",
      storefrontSession: "access_url",
      connectionStatus: "connected",
      imported: null,
      failed: null,
      channelStatus: null,
      brandStatus: null,
      themeId: null,
      themeStatus: null,
      previewUrl: null,
      fallbackUsed: null,
      evidenceMode: null,
      beforeScore: null,
      afterScore: null,
      optimizerStatus: null,
      restrictions: [],
    },
    stateText: "",
    importResult: null,
    channel: null,
    brief: null,
    theme: null,
    before: null,
    proposal: null,
    approved: null,
    after: null,
    sources: {
      "connection.json": "group",
      "products.import.result.json": "missing",
      "products.channel.json": "missing",
      "brand-brief.json": "missing",
      "theme.manifest.json": "missing",
      "geo.before.json": "missing",
      "geo.proposal.json": "missing",
      "geo.approved.json": "missing",
      "geo.after.json": "missing",
    },
    fixtureFilled: [],
    readErrors: [],
    ...overrides,
  };
}

function scorecard(score, dimensions) {
  return {
    store: "group-a.myshopify.com",
    geo_score: score,
    grade: gradeFor(score),
    evidence_mode: "admin_only",
    restrictions: ["html_evidence_skipped"],
    dimensions,
    top_issues: [{ issue: "Titles are short.", impact: "Harder to cite.", priority: "P0" }],
    products: [{ handle: "daily-serum", score }],
    skill: "shopify-geo-eval-workshop",
  };
}

test("formatDelta and grade follow the workshop scorecard bands", () => {
  assert.equal(formatDelta(39), "+39");
  assert.equal(formatDelta(0), "0");
  assert.equal(formatDelta(-2), "-2");
  assert.equal(formatDelta(null), "—");
  assert.equal(gradeFor(90), "A+");
  assert.equal(gradeFor(74), "B");
  assert.equal(gradeFor(35), "D");
});

test("summary model compares workshop dimensions and checks the delivery list", () => {
  const model = buildSummaryModel({
    groupId: "A",
    bundle: bundle({
      importResult: { imported: 8, failed: 0 },
      channel: { channel_status: "online_store_active", theme_published: false },
      brief: { brand_name: "Live Brand", category: "serum", selling_points: ["Plain notes"] },
      theme: {
        theme_id: 55,
        status: "unpublished",
        preview_url: "https://group-a.myshopify.com/?preview_theme_id=55",
        fallback_used: false,
      },
      before: scorecard(35, {
        product_data_completeness: 40,
        search_findability: 30,
        ai_understandability: 28,
        purchase_trust: 40,
        technical_visibility: 40,
      }),
      after: scorecard(74, {
        product_data_completeness: 80,
        search_findability: 82,
        ai_understandability: 75,
        purchase_trust: 70,
        technical_visibility: 40,
      }),
      approved: {
        suggestions: [
          { handle: "daily-serum", field: "title", before: "Serum", after: "Live Brand serum", priority: "P0" },
        ],
      },
      proposal: {
        suggestions: [
          { handle: "daily-serum", field: "faq", priority: "P1" },
        ],
      },
      sources: {
        "connection.json": "group",
        "products.import.result.json": "group",
        "products.channel.json": "group",
        "brand-brief.json": "group",
        "theme.manifest.json": "group",
        "geo.before.json": "group",
        "geo.proposal.json": "group",
        "geo.approved.json": "group",
        "geo.after.json": "group",
      },
    }),
  });

  assert.equal(model.scores.before, 35);
  assert.equal(model.scores.after, 74);
  assert.equal(model.scores.improvement, 39);
  assert.equal(model.scores.dimensions.length, 5);
  assert.equal(model.scores.dimensions[0].label, "Product Data Completeness");
  assert.equal(model.scores.dimensions[0].change, 40);
  assert.equal(model.checklist_complete, true);
  assert.equal(model.p0.count, 1);
  assert.equal(model.p0.p1_collapsed, 1);
  assert.equal(model.shopify_called, false);
  assert.match(renderMarkdown(model), /workshop scorecard, not the full diagnostic/);
  assert.match(renderMarkdown(model), /- \[x\] Preview Store connected/);
  assert.match(renderMarkdown(model), /\| GEO score \| 35 \(D\) \| 74 \(B\) \| \+39 \|/);
});

test("html escapes brand text and withholds a preview link that is not preview_theme_id", () => {
  const model = buildSummaryModel({
    groupId: "A",
    bundle: bundle({
      brief: { brand_name: "<script>alert(1)</script>", category: "serum" },
      theme: {
        theme_id: 9,
        status: "unpublished",
        preview_url: "https://evil.example/preview?preview_theme_id=9",
      },
      sources: {
        "connection.json": "group",
        "products.import.result.json": "missing",
        "products.channel.json": "missing",
        "brand-brief.json": "group",
        "theme.manifest.json": "group",
        "geo.before.json": "missing",
        "geo.proposal.json": "missing",
        "geo.approved.json": "missing",
        "geo.after.json": "missing",
      },
    }),
  });
  const html = renderHtml(model);
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(model.theme.preview_url, null);
  assert.equal(model.checklist.find((item) => item.id === "theme_preview").checked, false);
  assert.match(renderMarkdown(model), /preview link was withheld/i);
});

test("a published theme and a short import stay unchecked", () => {
  const model = buildSummaryModel({
    groupId: "A",
    bundle: bundle({
      importResult: { imported: 4, failed: 1 },
      channel: { channel_status: "online_store_active", theme_published: true },
      theme: {
        status: "unpublished",
        theme_id: 55,
        preview_url: "https://group-a.myshopify.com/?preview_theme_id=55",
      },
      sources: {
        "connection.json": "group",
        "products.import.result.json": "group",
        "products.channel.json": "group",
        "brand-brief.json": "missing",
        "theme.manifest.json": "group",
        "geo.before.json": "missing",
        "geo.proposal.json": "missing",
        "geo.approved.json": "missing",
        "geo.after.json": "missing",
      },
    }),
  });
  assert.equal(model.checklist.find((item) => item.id === "products_imported").checked, false);
  assert.equal(model.checklist.find((item) => item.id === "products_channel").checked, false);
  assert.equal(model.checklist.find((item) => item.id === "theme_preview").checked, false);
  assert.match(model.gaps.join("\n"), /Theme must stay unpublished/);
  assert.match(model.gaps.join("\n"), /outside the workshop target of 5/);
});

test("state scores are used when the scorecard file is absent", () => {
  const model = buildSummaryModel({
    groupId: "A",
    bundle: bundle({
      facts: {
        ...bundle().facts,
        beforeScore: 61,
        afterScore: 84,
        evidenceMode: "admin_only",
        optimizerStatus: "approved_p0_batch",
      },
    }),
  });
  assert.equal(model.scores.before, 61);
  assert.equal(model.scores.after, 84);
  assert.equal(model.scores.improvement, 23);
  assert.equal(model.checklist.find((item) => item.id === "p0_approved").checked, true);
  assert.equal(model.p0.count, 0);
});
