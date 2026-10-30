import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(SRC_DIR, "..");
export const REPO_ROOT = path.resolve(SRC_DIR, "../../..");

export const BRIEF_FILENAME = "brand-brief.json";
export const PLAN_FILENAME = "brand-brief.plan.json";

export function defaultSchemaPath() {
  return path.join(REPO_ROOT, "templates", "brand-brief.schema.json");
}

export function defaultDemoPath() {
  return path.join(REPO_ROOT, "templates", "brand-brief.demo.aurora-skincare.json");
}

export function repoRelative(filePath) {
  const relative = path.relative(REPO_ROOT, path.resolve(filePath));
  if (!relative || relative.startsWith("..")) return path.resolve(filePath);
  return relative;
}
