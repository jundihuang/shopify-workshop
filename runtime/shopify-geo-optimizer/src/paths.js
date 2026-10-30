import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(SRC_DIR, "..");
export const REPO_ROOT = path.resolve(SRC_DIR, "../../..");

export const PROPOSAL_FILENAME = "geo.proposal.json";
export const APPROVED_FILENAME = "geo.approved.json";
export const BEFORE_FILENAME = "geo.before.json";
export const AFTER_FILENAME = "geo.after.json";
export const AFTER_MARKDOWN_FILENAME = "geo.after.md";
export const BRIEF_FILENAME = "brand-brief.json";

export const P0_FIELDS = Object.freeze([
  "title",
  "description",
  "meta_title",
  "meta_description",
  "key_attributes",
]);

export const WORKSHOP_EVAL_CLI = path.join(
  REPO_ROOT,
  "runtime",
  "shopify-geo-eval-workshop",
  "src",
  "cli.js",
);

export function defaultFixturesDir() {
  return path.join(PACKAGE_ROOT, "fixtures");
}

export function defaultAfterFixturePath() {
  return path.join(defaultFixturesDir(), "geo.after.json");
}
