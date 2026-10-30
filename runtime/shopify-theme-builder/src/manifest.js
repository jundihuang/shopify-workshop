import { readJsonFile } from "./files.js";
import { PAGES } from "./paths.js";
import { publicFill } from "./fill.js";

const PREVIEW_URL = /^https:\/\/[a-z0-9][a-z0-9-]*\.myshopify\.com\/\?preview_theme_id=\d+$/;

export function previewUrlFor(store, themeId) {
  const id = Number(themeId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("theme_id must be a positive integer");
  const storeName = String(store || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(storeName)) {
    throw new Error("preview_url requires a myshopify.com store domain");
  }
  const previewUrl = `https://${storeName}/?preview_theme_id=${id}`;
  if (!PREVIEW_URL.test(previewUrl)) throw new Error("preview_url is not an unpublished theme preview");
  return previewUrl;
}

export function buildManifest({
  themeId,
  status,
  store,
  fallbackUsed,
  pages = PAGES,
  fill = null,
  extra = {},
}) {
  if (status !== "unpublished" && status !== "fallback") {
    throw new Error('theme status must be "unpublished" or "fallback"');
  }
  const preview_url = previewUrlFor(store, themeId);
  const safeExtra = { ...extra };
  delete safeExtra.theme_id;
  delete safeExtra.status;
  delete safeExtra.preview_url;
  delete safeExtra.fallback_used;
  delete safeExtra.pages;
  delete safeExtra.accessUrl;
  delete safeExtra.access_url;
  delete safeExtra.password;
  delete safeExtra.token;

  return {
    theme_id: Number(themeId),
    status,
    preview_url,
    fallback_used: Boolean(fallbackUsed),
    pages: [...pages],
    store: String(store).trim().toLowerCase(),
    store_type: "preview",
    live_theme_touched: false,
    theme_publish_invoked: false,
    products_touched: false,
    channel_status_changed: false,
    ...(fill ? { fill: publicFill(fill) } : {}),
    ...safeExtra,
  };
}

export function parseDemoThemeId(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  if (!/^[1-9]\d*$/.test(String(value).trim())) {
    throw new Error("SHOPWRIGHT_DEMO_THEME_ID must be a positive integer");
  }
  return Number(String(value).trim());
}

export async function loadDemoManifest({ store, manifestPath, themeIdOverride = null, reason }) {
  const fixture = await readJsonFile(manifestPath);
  const themeId = themeIdOverride || fixture.theme_id;
  const pages = Array.isArray(fixture.pages) && fixture.pages.length > 0 ? fixture.pages : PAGES;
  return buildManifest({
    themeId,
    status: "fallback",
    store,
    fallbackUsed: true,
    pages,
    extra: {
      demo: true,
      documented_demo: true,
      demo_theme_on_store: Boolean(themeIdOverride),
      demo_theme_name: fixture.demo_theme_name || "ShopWright Demo Theme",
      fixture: "templates/theme.manifest.demo.json",
      fallback_reason: reason,
      note: typeof fixture.note === "string" ? fixture.note : undefined,
    },
  });
}

export async function loadDryRunManifest({ store, fixturePath, fill }) {
  const fixture = await readJsonFile(fixturePath);
  const theme = fixture.theme && typeof fixture.theme === "object" ? fixture.theme : fixture;
  const role = String(theme.role || "unpublished").toLowerCase();
  if (role !== "unpublished") {
    throw new Error(`Dry-run theme fixture role must be unpublished, received "${role}"`);
  }
  return buildManifest({
    themeId: theme.id ?? theme.theme_id,
    status: "unpublished",
    store,
    fallbackUsed: false,
    fill,
    extra: {
      dry_run: true,
      fake: true,
      demo: false,
      shopify_called: false,
      upload_strategy: "push",
      planned_command: "shopify theme push --unpublished --json",
      fixture: "fixtures/theme-push.unpublished.success.json",
      theme_name: theme.name || (fill ? fill.theme_name : null),
      role: "unpublished",
    },
  });
}
