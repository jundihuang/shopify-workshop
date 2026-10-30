import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(SRC_DIR, "..");

export const PLAN_FILENAME = "workshop-summary.plan.json";
export const SUMMARY_JSON_FILENAME = "workshop-summary.json";
export const SUMMARY_MARKDOWN_FILENAME = "workshop-summary.md";
export const SUMMARY_HTML_FILENAME = "workshop-summary.html";
export const STATE_FILENAME = "workshop-state.yaml";

export const CONNECTION_FILENAME = "connection.json";
export const IMPORT_FILENAME = "products.import.result.json";
export const CHANNEL_FILENAME = "products.channel.json";
export const BRIEF_FILENAME = "brand-brief.json";
export const THEME_FILENAME = "theme.manifest.json";
export const BEFORE_FILENAME = "geo.before.json";
export const PROPOSAL_FILENAME = "geo.proposal.json";
export const APPROVED_FILENAME = "geo.approved.json";
export const AFTER_FILENAME = "geo.after.json";

export const ARTIFACT_FILES = Object.freeze([
  CONNECTION_FILENAME,
  IMPORT_FILENAME,
  CHANNEL_FILENAME,
  BRIEF_FILENAME,
  THEME_FILENAME,
  BEFORE_FILENAME,
  PROPOSAL_FILENAME,
  APPROVED_FILENAME,
  AFTER_FILENAME,
]);

export function defaultFixturesDir() {
  return path.join(PACKAGE_ROOT, "fixtures");
}
