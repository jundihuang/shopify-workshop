import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(SRC_DIR, "..");
export const REPO_ROOT = path.resolve(SRC_DIR, "../../..");

export const PLAN_FILENAME = "theme.plan.json";
export const MANIFEST_FILENAME = "theme.manifest.json";
export const THEME_WORK_DIRNAME = "theme-work";
export const PAGES = Object.freeze(["home", "collection", "product"]);

export function defaultSkeletonDir() {
  return path.join(PACKAGE_ROOT, "skeleton");
}

export function defaultDemoManifestPath() {
  return path.join(REPO_ROOT, "templates", "theme.manifest.demo.json");
}

export function defaultPushFixturePath() {
  return path.join(PACKAGE_ROOT, "fixtures", "theme-push.unpublished.success.json");
}

export function repoRelative(filePath) {
  const relative = path.relative(REPO_ROOT, path.resolve(filePath));
  if (!relative || relative.startsWith("..")) return path.resolve(filePath);
  return relative;
}
