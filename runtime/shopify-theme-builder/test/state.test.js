import test from "node:test";
import assert from "node:assert/strict";
import { updateThemeState } from "../src/state.js";

const EXISTING = `group_id: "A"
store_domain: "aurora-workshop-mvp.myshopify.com"
mode: "hands_on"

connection:
  status: connected
  store_type: preview
  scopes_ok: true
  auth: cli_cached_admin_token
  storefront_session: access_url

products:
  source_file: "products.csv"
  imported: 8
  failed: 0
  status: done
  channel_status: draft

brand:
  brief_file: brand-brief.json
  status: done
  source: student

theme:
  theme_id: null
  status: none
  preview_url: null
  fallback_used: false
  note: kept

geo:
  evidence_mode: admin_only
  before_score: null
  after_score: null
  optimizer_status: pending
`;

test("theme state update preserves connection, products, and brand", () => {
  const next = updateThemeState(EXISTING, {
    themeId: 880000111,
    status: "unpublished",
    previewUrl: "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=880000111",
    fallbackUsed: false,
  });
  assert.match(next, /theme_id: 880000111/);
  assert.match(next, /status: unpublished/);
  assert.match(next, /preview_url: "https:\/\/aurora-workshop-mvp\.myshopify\.com\/\?preview_theme_id=880000111"/);
  assert.match(next, /fallback_used: false/);
  assert.match(next, /note: kept/);
  assert.match(next, /store_type: preview/);
  assert.match(next, /channel_status: draft/);
  assert.match(next, /brief_file: brand-brief\.json/);
  assert.match(next, /status: done/);
  assert.match(next, /source: student/);
  assert.match(next, /storefront_session: access_url/);
  assert.match(next, /optimizer_status: pending/);
  assert.doesNotMatch(next, /status: none/);
  assert.doesNotMatch(next, /access[_-]?url\s*:\s*https?:\/\//i);
});

test("theme state update can switch an unpublished theme to the demo fallback", () => {
  const uploaded = updateThemeState(EXISTING, {
    themeId: 880000111,
    status: "unpublished",
    previewUrl: "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=880000111",
    fallbackUsed: false,
  });
  const fallback = updateThemeState(uploaded, {
    themeId: 900000001,
    status: "fallback",
    previewUrl: "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=900000001",
    fallbackUsed: true,
  });
  assert.match(fallback, /status: fallback/);
  assert.match(fallback, /fallback_used: true/);
  assert.match(fallback, /channel_status: draft/);
  assert.match(fallback, /source: student/);
  assert.equal(fallback.includes("status: unpublished"), false);
});

test("theme state update appends a theme section and refuses an accessUrl value", () => {
  const created = updateThemeState("group_id: A\n", {
    themeId: 900000001,
    status: "fallback",
    previewUrl: "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=900000001",
    fallbackUsed: true,
  });
  assert.match(created, /theme:\n {2}theme_id: 900000001\n {2}status: fallback/);

  assert.throws(
    () => updateThemeState("access_url: https://preview.example.invalid/secret\n", {
      themeId: 1,
      status: "unpublished",
      previewUrl: "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=1",
      fallbackUsed: false,
    }),
    /accessUrl/,
  );
});
