import test from "node:test";
import assert from "node:assert/strict";
import {
  assertUploadAllowed,
  buildThemePushArgs,
  buildThemeShareArgs,
  chooseThemeUploadStrategy,
  DEFAULT_THEME_PUSH_TIMEOUT_MS,
  MAX_THEME_PUSH_TIMEOUT_MS,
  parseThemePushPayload,
  resolveThemePushTimeoutMs,
  resolveThemeUpload,
  ThemeUploadError,
} from "../src/shopify.js";
import { previewUrlFor } from "../src/manifest.js";

test("unpublished push args never include a live publish or dev command", () => {
  const args = buildThemePushArgs({
    store: "aurora-workshop-mvp.myshopify.com",
    themePath: "/tmp/theme-work",
  });
  assert.deepEqual(args.slice(0, 4), ["theme", "push", "--unpublished", "--json"]);
  assert.equal(args.includes("--store"), true);
  assert.equal(args.includes("publish"), false);
  assert.equal(args.includes("dev"), false);
  assert.equal(args.includes("--live"), false);
  assert.throws(() => assertUploadAllowed(["theme", "publish", "--json"]), ThemeUploadError);
  assert.throws(() => assertUploadAllowed(["theme", "dev"]), ThemeUploadError);
  assert.throws(() => assertUploadAllowed(["theme", "push", "--live", "--json"]), ThemeUploadError);
  assert.throws(() => assertUploadAllowed(["theme", "push", "--json"]), /unpublished/);
});

test("theme share is selected only when unpublished push is unavailable", () => {
  assert.equal(
    chooseThemeUploadStrategy({ pushHelp: "Usage: theme push --unpublished --json", shareHelp: "" }),
    "push",
  );
  assert.equal(
    chooseThemeUploadStrategy({ pushHelp: "Usage: theme push --json", shareHelp: "Usage: theme share --json" }),
    "share",
  );
  assert.throws(
    () => chooseThemeUploadStrategy({ pushHelp: "Usage: theme push", shareHelp: "Usage: theme share" }),
    /unpublished/,
  );
  const shareArgs = buildThemeShareArgs({ store: "aurora-workshop-mvp.myshopify.com", themePath: "/tmp/theme-work" });
  assert.deepEqual(shareArgs.slice(0, 3), ["theme", "share", "--json"]);
  assert.equal(shareArgs.includes("publish"), false);
  assert.equal(shareArgs.includes("dev"), false);
});

test("push timeout stays inside the 3 to 4 minute workshop window", () => {
  assert.equal(resolveThemePushTimeoutMs(""), DEFAULT_THEME_PUSH_TIMEOUT_MS);
  assert.equal(DEFAULT_THEME_PUSH_TIMEOUT_MS, 210_000);
  assert.equal(MAX_THEME_PUSH_TIMEOUT_MS, 240_000);
  assert.equal(resolveThemePushTimeoutMs("180000"), 180_000);
  assert.equal(resolveThemePushTimeoutMs("999999"), 240_000);
});

test("preview_url uses the connected store and ignores CLI localhost or password URLs", () => {
  const parsed = parseThemePushPayload(JSON.stringify({
    theme: {
      id: 770000222,
      name: "ShopWright",
      role: "unpublished",
      preview_url: "http://127.0.0.1:9292/?preview_theme_id=770000222&password=nope",
      editor_url: "https://evil.example/admin/themes/770000222",
      accessUrl: "https://preview.example.invalid/access/secret",
    },
  }));
  assert.equal(parsed.theme_id, 770000222);
  assert.equal(parsed.role, "unpublished");
  assert.equal(Object.hasOwn(parsed, "preview_url"), false);
  assert.equal(Object.hasOwn(parsed, "accessUrl"), false);
  assert.equal(
    previewUrlFor("Aurora-Workshop-MVP.myshopify.com", parsed.theme_id),
    "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=770000222",
  );
});

test("a live theme role is refused and an upload failure resolves to the demo manifest", async () => {
  assert.throws(
    () => parseThemePushPayload(JSON.stringify({ theme: { id: 5, role: "main" } })),
    /unpublished/,
  );

  const resolved = await resolveThemeUpload({
    mode: "push",
    push: async () => {
      throw Object.assign(new Error("theme upload timed out"), { killed: true });
    },
    loadDemo: async (reason) => ({
      theme_id: 900000001,
      status: "fallback",
      preview_url: "https://aurora-workshop-mvp.myshopify.com/?preview_theme_id=900000001",
      fallback_used: true,
      fallback_reason: reason,
      pages: ["home", "collection", "product"],
    }),
    loadFixture: async () => {
      throw new Error("fixture should not be used");
    },
  });
  assert.equal(resolved.shopify_called, true);
  assert.equal(resolved.fallback_reason, "timeout");
  assert.equal(resolved.manifest.status, "fallback");
  assert.equal(resolved.manifest.fallback_used, true);
  assert.equal(resolved.manifest.theme_id, 900000001);
  assert.match(resolved.manifest.preview_url, /^https:\/\/aurora-workshop-mvp\.myshopify\.com\/\?preview_theme_id=900000001$/);

  const dry = await resolveThemeUpload({
    mode: "dry-run",
    push: async () => {
      throw new Error("push should not run");
    },
    loadDemo: async () => {
      throw new Error("demo should not run");
    },
    loadFixture: async () => ({ theme_id: 880000111, status: "unpublished", fallback_used: false }),
  });
  assert.equal(dry.shopify_called, false);
  assert.equal(dry.manifest.theme_id, 880000111);
});
