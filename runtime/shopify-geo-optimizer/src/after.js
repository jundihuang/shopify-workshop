import { loadGeoScoreSchema, validateGeoScore } from "../../shopify-geo-eval-workshop/src/schema.js";
import { readJsonFile } from "./files.js";
import { defaultAfterFixturePath } from "./paths.js";

function safePreviewUrl(store, previewUrl) {
  if (typeof previewUrl !== "string" || typeof store !== "string") return undefined;
  const escaped = store.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^https://${escaped}/\\?preview_theme_id=\\d+$`).test(previewUrl) ? previewUrl : undefined;
}

/**
 * Dry-run after score. The numbers are a fixture, not a rescore.
 * Live apply calls shopify-geo-eval-workshop instead.
 */
export async function loadFixtureAfterScore({ before, store, fixturePath = defaultAfterFixturePath() }) {
  const fixture = await readJsonFile(fixturePath);
  const next = { ...fixture, store };
  if (before?.evidence_mode) next.evidence_mode = before.evidence_mode;
  if (Array.isArray(before?.restrictions)) next.restrictions = [...before.restrictions];
  if (Array.isArray(before?.products) && Array.isArray(next.products) && before.products.length === next.products.length) {
    next.products = next.products.map((product, index) => ({
      ...product,
      handle: before.products[index].handle,
    }));
  }
  const preview = safePreviewUrl(store, before?.preview_url);
  if (preview) next.preview_url = preview;
  else delete next.preview_url;

  const schema = await loadGeoScoreSchema();
  const errors = validateGeoScore(next, schema);
  if (errors.length > 0) {
    throw new Error(`Fixture after score is not a workshop scorecard: ${errors.map((entry) => entry.message).join("; ")}`);
  }
  return next;
}

export function renderFixtureAfterMarkdown(scorecard) {
  return `# Workshop GEO after score (fixture)

Dry-run fixture for the workshop optimizer. This is not a live rescore.
Live apply calls shopify-geo-eval-workshop and writes a new scorecard.

| | |
|---|---|
| Store | ${scorecard.store} |
| Score | **${scorecard.geo_score}** (${scorecard.grade}) |
| Evidence | ${scorecard.evidence_mode} |
| Sample | ${scorecard.products.length} |

skill: shopify-geo-eval-workshop
`;
}
