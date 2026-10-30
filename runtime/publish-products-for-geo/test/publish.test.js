import test from "node:test";
import assert from "node:assert/strict";
import { publishProducts } from "../src/publish.js";

test("real publish resolves Online Store and never issues a theme mutation", async () => {
  const calls = [];
  const executeGraphql = async ({ domain, query, variables }) => {
    calls.push({ domain, query, variables });
    if (query.includes("publications(first:")) {
      return {
        publications: {
          nodes: [
            { id: "gid://shopify/Publication/7000000001", name: "Online Store" },
            { id: "gid://shopify/Publication/7000000002", name: "Pos" },
          ],
        },
      };
    }
    if (query.includes("productUpdate")) {
      return {
        productUpdate: {
          product: { id: variables.product.id, status: "ACTIVE" },
          userErrors: [],
        },
      };
    }
    if (query.includes("publishablePublish")) {
      return { publishablePublish: { userErrors: [] } };
    }
    throw new Error("unexpected query");
  };

  const result = await publishProducts({
    plan: {
      products: [
        {
          product_id: "gid://shopify/Product/1001",
          handle: "one",
          title: "One",
          current_status: "draft",
        },
      ],
    },
    connection: {
      store: "aurora-workshop-mvp.myshopify.com",
      auth: "cli_cached_admin_token",
    },
    executeGraphql,
  });

  assert.equal(calls.length, 3);
  assert.match(calls[0].query, /publications/);
  assert.match(calls[1].query, /productUpdate/);
  assert.equal(calls[1].variables.product.status, "ACTIVE");
  assert.match(calls[2].query, /publishablePublish/);
  assert.deepEqual(calls[2].variables.input, [{ publicationId: "gid://shopify/Publication/7000000001" }]);
  assert.equal(calls.some((call) => /theme/i.test(call.query)), false);
  assert.equal(result.summary.published, 1);
  assert.equal(result.theme.touched, false);
  assert.equal(result.theme.published, false);
  assert.equal(result.channels_published, true);
});

test("partial mutation failure is recorded and does not claim channel success", async () => {
  const result = await publishProducts({
    plan: {
      products: [
        { product_id: "gid://shopify/Product/1001", handle: "one", current_status: "draft" },
        { product_id: "gid://shopify/Product/1002", handle: "two", current_status: "draft" },
      ],
    },
    connection: { store: "aurora-workshop-mvp.myshopify.com", auth: "cli_cached_admin_token" },
    executeGraphql: async ({ query, variables }) => {
      if (query.includes("publications(first:")) {
        return { publications: { nodes: [{ id: "gid://shopify/Publication/7000000001", name: "Online Store" }] } };
      }
      if (query.includes("productUpdate")) {
        if (variables.product.id.endsWith("1002")) {
          return { productUpdate: { userErrors: [{ field: ["status"], message: "not allowed" }] } };
        }
        return { productUpdate: { product: { id: variables.product.id, status: "ACTIVE" }, userErrors: [] } };
      }
      return { publishablePublish: { userErrors: [] } };
    },
  });
  assert.equal(result.summary.activated, 1);
  assert.equal(result.summary.published, 1);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.channels_published, false);
  assert.equal(result.shopify_status, "partial");
});
