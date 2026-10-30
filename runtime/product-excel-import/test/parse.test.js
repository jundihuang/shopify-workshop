import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProductsFile, buildPreview } from "../src/products.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const csvPath = path.join(repoRoot, "templates/products.inflationwear-tshirt.sample.csv");
const xlsxPath = path.join(repoRoot, "templates/products.inflationwear-tshirt.sample.xlsx");

test("parses the Inflation Wear CSV sample and ignores source_url", async () => {
  const parsed = await parseProductsFile(csvPath);
  assert.equal(parsed.format, "csv");
  assert.equal(parsed.records.length, 8);
  assert.equal(parsed.fieldMap.title, "title");
  assert.equal(parsed.fieldMap.source_url, undefined);
  assert.ok(parsed.ignoredColumns.includes("source_url"));
  const preview = await buildPreview({ filePath: csvPath });
  assert.equal(preview.total_rows, 8);
  assert.equal(preview.default_status, "draft");
  assert.equal(preview.products[0].title, "Heavyweight Cotton Oversized T-Shirt");
  assert.equal(preview.products[0].data.sku, "265SS187S");
  assert.equal(preview.products[0].data.price, "19.99");
  assert.equal(preview.products[0].data.status, "draft");
});

test("parses the Inflation Wear XLSX sample with the same SKUs as CSV", async () => {
  const csv = await parseProductsFile(csvPath);
  const xlsx = await parseProductsFile(xlsxPath);
  assert.equal(xlsx.format, "xlsx");
  assert.equal(xlsx.records.length, 8);
  assert.deepEqual(
    xlsx.records.map((record) => record.cells.sku),
    csv.records.map((record) => record.cells.sku),
  );
  const preview = await buildPreview({ filePath: xlsxPath });
  assert.equal(preview.total_rows, 8);
  assert.equal(preview.products[7].title, "Pink X-Ray Skeleton Boxy T-Shirt");
});
