import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(SRC_DIR, "..");
export const REPO_ROOT = path.resolve(SRC_DIR, "../../..");

export const PLAN_FILENAME = "geo.plan.json";
export const SCORE_FILENAME = "geo.before.json";
export const SCORE_MARKDOWN_FILENAME = "geo.before.md";
export const AFTER_SCORE_FILENAME = "geo.after.json";
export const AFTER_MARKDOWN_FILENAME = "geo.after.md";
export const SAMPLE_LIMIT = 10;
export const ADMIN_PROBE_LIMIT = 11;

export function defaultFixturesDir() {
  return path.join(PACKAGE_ROOT, "fixtures");
}

export function defaultProductsFixturePath() {
  return path.join(defaultFixturesDir(), "admin-products.success.json");
}

export function defaultSchemaPath() {
  return path.join(REPO_ROOT, "templates", "geo-score.schema.json");
}
