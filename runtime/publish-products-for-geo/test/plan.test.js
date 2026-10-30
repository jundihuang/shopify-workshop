import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import {
  buildPlanObject,
  CONFIRM_COPY,
  extractDraftProductsFromPayload,
  extractProductsFromImportResult,
  loadPlanProducts,
  parseProductIdList,
} from "../src/plan.js";

test("parses only successful product ids from products.import.result.json", () => {
  const products = extractProductsFromImportResult({
    results: [
      { ok: true, product_id: "gid://shopify/Product/1001", handle: "one", title: "One", shopify_status: "draft" },
      { ok: false, product_id: "gid://shopify/Product/1002", handle: "two" },
      { ok: true, product_id: "gid://shopify/Product/1003", handle: "three" },
      { ok: true, product_id: "gid://shopify/Product/1001", handle: "one-duplicate" },
    ],
  });
  assert.deepEqual(products.map((product) => product.product_id), [
    "gid://shopify/Product/1001",
    "gid://shopify/Product/1003",
  ]);
  assert.equal(products[0].handle, "one");
  assert.equal(products[1].source, "products.import.result.json");
});

test("explicit product ids override the import result and are normalized", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "publish-plan-explicit-"));
  try {
    const groupDir = path.join(temp, ".workshop", "A");
    await mkdir(groupDir, { recursive: true });
    await writeFile(
      path.join(groupDir, "products.import.result.json"),
      JSON.stringify({
        results: [{ ok: true, product_id: "gid://shopify/Product/1001", handle: "imported" }],
      }),
    );
    const ids = parseProductIdList(["1002", "gid://shopify/Product/1003", "1002"]);
    assert.deepEqual(ids, ["gid://shopify/Product/1002", "gid://shopify/Product/1003"]);

    const loaded = await loadPlanProducts({ groupDir, productIds: ids });
    assert.equal(loaded.source, "explicit_product_ids");
    assert.deepEqual(loaded.products.map((product) => product.product_id), ids);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("falls back to a read-only Admin Draft-products query when the import result is absent", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "publish-plan-fallback-"));
  try {
    const groupDir = path.join(temp, ".workshop", "A");
    await mkdir(groupDir, { recursive: true });
    let querySeen = "";
    const loaded = await loadPlanProducts({
      groupDir,
      domain: "aurora-workshop-mvp.myshopify.com",
      executeGraphql: async ({ query }) => {
        querySeen = query;
        return {
          products: {
            nodes: [
              { id: "gid://shopify/Product/2001", handle: "draft-one", title: "Draft One", status: "DRAFT" },
              { id: "gid://shopify/Product/2002", handle: "active-two", title: "Active Two", status: "ACTIVE" },
            ],
          },
        };
      },
    });
    assert.match(querySeen, /status:draft/);
    assert.equal(loaded.source, "admin_draft_products");
    assert.deepEqual(loaded.products.map((product) => product.product_id), ["gid://shopify/Product/2001"]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("extracts only DRAFT nodes from an Admin products payload", () => {
  const products = extractDraftProductsFromPayload({
    data: {
      products: {
        edges: [
          { node: { id: "gid://shopify/Product/3001", handle: "draft", status: "DRAFT" } },
          { node: { id: "gid://shopify/Product/3002", handle: "active", status: "ACTIVE" } },
        ],
      },
    },
  });
  assert.equal(products.length, 1);
  assert.equal(products[0].handle, "draft");
});

test("plan object includes human confirm copy, risk line, and theme no-op", () => {
  const plan = buildPlanObject({
    connection: { store: "aurora-workshop-mvp.myshopify.com", auth: "cli_cached_admin_token" },
    products: [
      { product_id: "gid://shopify/Product/1001", handle: "one" },
      { product_id: "gid://shopify/Product/1002", handle: "two" },
    ],
    source: "products.import.result.json",
  });
  assert.equal(plan.participant_confirm_copy, CONFIRM_COPY);
  assert.match(plan.risk_one_liner, /2 个商品/);
  assert.match(plan.risk_one_liner, /主题保持 Unpublished/);
  assert.equal(plan.theme.touched, false);
  assert.equal(plan.theme.published, false);
  assert.deepEqual(plan.product_ids, ["gid://shopify/Product/1001", "gid://shopify/Product/1002"]);
});
