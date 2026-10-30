import test from "node:test";
import assert from "node:assert/strict";
import { collectHtmlEvidence } from "../src/html.js";
import { PRODUCTS_QUERY } from "../src/shopify.js";

const SESSION = "https://preview.example.invalid/s?session=abc&password=hunter2";

function response({ status, body = "" }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
  };
}

test("429 retries then keeps the session url out of the result", async () => {
  const calls = [];
  const result = await collectHtmlEvidence({
    handles: ["tee"],
    previewThemeId: "123",
    loadAccessUrl: async () => SESSION,
    sleep: async () => {},
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (calls.length < 3) return response({ status: 429 });
      return response({
        status: 200,
        body: '<html><script type="application/ld+json">{"@type":"Product","name":"Tee"}</script></html>',
      });
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(calls.every((url) => url.includes("session=abc")), true);
  assert.equal(calls.every((url) => url.includes("preview_theme_id=123")), true);
  assert.equal(calls.every((url) => !url.includes("password")), true);
  assert.equal(result.byHandle.tee.schema_present, true);
  assert.equal(result.restrictions.length, 0);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("preview.example.invalid"), false);
  assert.equal(serialized.includes("session=abc"), false);
  assert.equal(serialized.includes("hunter2"), false);
});

test("repeated 429 becomes access_url_rate_limited without saving the session", async () => {
  let calls = 0;
  const result = await collectHtmlEvidence({
    handles: ["tee"],
    loadAccessUrl: async () => SESSION,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return response({ status: 429 });
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(result.byHandle, {});
  assert.deepEqual(result.restrictions, ["access_url_rate_limited"]);
  assert.equal(JSON.stringify(result).includes(SESSION), false);
});

test("Opening soon HTML is not treated as storefront evidence", async () => {
  const result = await collectHtmlEvidence({
    handles: ["tee"],
    loadAccessUrl: async () => "https://preview.example.invalid/s?session=abc",
    fetchImpl: async () => response({ status: 200, body: "<html><title>Opening soon</title><form>Password</form></html>" }),
  });
  assert.deepEqual(result.byHandle, {});
  assert.deepEqual(result.restrictions, ["unauthenticated_storefront_restricted"]);
  assert.equal(JSON.stringify(result).includes("preview.example.invalid"), false);
});

test("missing session stays admin-side and the product query is read-only", async () => {
  const result = await collectHtmlEvidence({
    handles: ["tee"],
    loadAccessUrl: async () => null,
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    },
  });
  assert.deepEqual(result.restrictions, ["storefront_session_missing"]);
  assert.match(PRODUCTS_QUERY, /^\s*query\b/);
  assert.doesNotMatch(PRODUCTS_QUERY, /mutation|password|onlineStorePasswordProtectionUpdate/i);
});
