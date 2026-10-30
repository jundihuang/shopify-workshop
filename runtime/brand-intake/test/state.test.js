import test from "node:test";
import assert from "node:assert/strict";
import { updateBrandState } from "../src/state.js";

const EXISTING = `group_id: "A"
store_domain: "aurora-workshop-mvp.myshopify.com"
mode: "demo"

connection:
  status: connected
  store_type: preview
  scopes_ok: true
  auth: cli_cached_admin_token
  storefront_session: access_url

products:
  source_file: "products.csv"
  imported: 2
  failed: 0
  status: done
  channel_status: online_store_active

brand:
  brief_file: null
  status: pending

theme:
  theme_id: 123
  status: unpublished
  preview_url: "https://aurora-workshop.myshopify.com/?preview_theme_id=123"
  fallback_used: false
`;

test("brand state update preserves connection, products, and theme", () => {
  const next = updateBrandState(EXISTING, { status: "done" });
  assert.match(next, /brief_file: brand-brief\.json/);
  assert.match(next, /status: done/);
  assert.match(next, /store_type: preview/);
  assert.match(next, /channel_status: online_store_active/);
  assert.match(next, /theme:\n {2}theme_id: 123\n {2}status: unpublished/);
  assert.match(next, /storefront_session: access_url/);
  assert.doesNotMatch(next, /access[_-]?url\s*:\s*https?:\/\//i);
  assert.equal(next.includes("status: pending"), false);
});

test("brand state update can switch a locked brief to the demo fallback", () => {
  const locked = updateBrandState(EXISTING, { status: "done" });
  const fallback = updateBrandState(locked, { status: "fallback_demo" });
  assert.match(fallback, /status: fallback_demo/);
  assert.match(fallback, /channel_status: online_store_active/);
  assert.match(fallback, /fallback_used: false/);
});

test("brand state update appends a brand section and refuses an accessUrl value", () => {
  const created = updateBrandState("group_id: A\n", { status: "fallback_demo" });
  assert.match(created, /brand:\n {2}brief_file: brand-brief\.json\n {2}status: fallback_demo/);

  assert.throws(
    () => updateBrandState("access_url: https://preview.example.invalid/secret\n", { status: "done" }),
    /accessUrl/,
  );
});
