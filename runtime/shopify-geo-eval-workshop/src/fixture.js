import path from "node:path";
import { readJsonFile } from "./files.js";
import { normalizeProduct } from "./score.js";

export async function loadFixtureProducts(fixturesDir) {
  const json = await readJsonFile(path.join(fixturesDir, "admin-products.success.json"));
  const list = Array.isArray(json) ? json : json?.products;
  if (!Array.isArray(list)) {
    throw new Error("Fixture admin-products.success.json must contain a products array");
  }
  return list.map((item) => normalizeProduct(item)).filter(Boolean);
}
