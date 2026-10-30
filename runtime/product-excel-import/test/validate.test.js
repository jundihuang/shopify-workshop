import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { buildPreview, SHOPIFY_PLACEHOLDER_IMAGE } from "../src/products.js";

async function withCsv(contents, callback) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "product-import-validate-"));
  try {
    const file = path.join(temp, "products.csv");
    await writeFile(file, contents, "utf8");
    return await callback(file);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test("classifies missing title, invalid price, and duplicate SKU as blocked", async () => {
  const csv = `handle,title,description,product_type,price,sku,image_url
row-one,First Product,A description,T-Shirt,19.99,SKU-1,https://example.com/one.jpg
row-two,,Second description,T-Shirt,not-a-price,SKU-1,https://example.com/two.jpg
`;
  await withCsv(csv, async (file) => {
    const preview = await buildPreview({ filePath: file });
    assert.equal(preview.total_rows, 2);
    assert.equal(preview.blocked, 2);
    const firstCodes = preview.products[0].issues.map((issue) => issue.code);
    const secondCodes = preview.products[1].issues.map((issue) => issue.code);
    assert.ok(firstCodes.includes("duplicate_sku"));
    assert.ok(secondCodes.includes("missing_title"));
    assert.ok(secondCodes.includes("invalid_price"));
    assert.ok(secondCodes.includes("duplicate_sku"));
  });
});

test("demo image mode replaces a missing image and avoids a block", async () => {
  const csv = `handle,title,description,product_type,price,sku,image_url
row-one,First Product,A description,T-Shirt,19.99,SKU-1,
`;
  await withCsv(csv, async (file) => {
    const preview = await buildPreview({ filePath: file, demoImages: true });
    assert.equal(preview.blocked, 0);
    assert.equal(preview.products[0].data.image_url, SHOPIFY_PLACEHOLDER_IMAGE);
    assert.equal(preview.products[0].image_source, "demo_placeholder");
    assert.ok(preview.products[0].issues.some((issue) => issue.code === "image_fallback_demo"));
  });
});

test("unreachable image blocks unless demo image fallback is enabled", async () => {
  const csv = `handle,title,description,product_type,price,sku,image_url
row-one,First Product,A description,T-Shirt,19.99,SKU-1,https://example.com/missing.jpg
`;
  await withCsv(csv, async (file) => {
    const blocked = await buildPreview({
      filePath: file,
      checkImages: true,
      imageProbe: async () => false,
    });
    assert.equal(blocked.blocked, 1);
    assert.ok(blocked.products[0].issues.some((issue) => issue.code === "unreachable_image_url"));

    const demo = await buildPreview({
      filePath: file,
      checkImages: true,
      demoImages: true,
      imageProbe: async () => false,
    });
    assert.equal(demo.blocked, 0);
    assert.equal(demo.products[0].data.image_url, SHOPIFY_PLACEHOLDER_IMAGE);
  });
});
