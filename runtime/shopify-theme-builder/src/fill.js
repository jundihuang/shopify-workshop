import fs from "node:fs/promises";
import path from "node:path";
import { PAGES } from "./paths.js";
import { assertArtifactSafe, assertNoRawAccessUrl, assertNoSensitiveKeys } from "./redact.js";

export const DEFAULT_PRIMARY = "#1F4E5F";
export const DEFAULT_SECONDARY = "#F3EDE4";
const HEX = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const RISKY_COPY = /\b(?:cures?|heals?|clinically\s+proven|miracles?|guarantee[ds]?|overnight)\b|治愈|根治|治疗/i;

export function asText(value, max = 280) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizeColor(value, fallback) {
  if (typeof value !== "string" || !value.trim()) {
    return { color: fallback, usedDefault: true, invalid: false, missing: true };
  }
  const trimmed = value.trim();
  if (!HEX.test(trimmed)) {
    return { color: fallback, usedDefault: true, invalid: true, missing: false };
  }
  return { color: trimmed.toUpperCase(), usedDefault: false, invalid: false, missing: false };
}

function stringList(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, maxItems)
    .map((item) => asText(item, maxLen));
}

function pageIntent(brief, page) {
  const pages = brief.pages;
  if (!pages || typeof pages !== "object") return "";
  const node = pages[page];
  if (!node || typeof node !== "object") return "";
  return asText(node.intent, 400);
}

export function publicFill(summary) {
  return {
    brand_name: summary.brand_name,
    primary_color: summary.primary_color,
    secondary_color: summary.secondary_color,
    logo_set: summary.logo_set,
    theme_name: summary.theme_name,
    pages: summary.pages,
  };
}

/**
 * Map a locked brand brief onto the skeleton's settings and section copy.
 * Does not write files and does not call Shopify.
 */
export function summarizeFill(brief) {
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
    throw new Error("brand-brief.json must be an object");
  }
  assertNoSensitiveKeys(brief, "brand brief");

  const brandName = asText(brief.brand_name, 80);
  if (!brandName) {
    throw new Error("brand-brief.json is missing brand_name. Run brand-intake apply --confirm first.");
  }

  const tagline = asText(brief.tagline, 180);
  const positioning = asText(brief.positioning, 400);
  const primary = normalizeColor(brief.visual && brief.visual.primary_color, DEFAULT_PRIMARY);
  const secondary = normalizeColor(brief.visual && brief.visual.secondary_color, DEFAULT_SECONDARY);
  const logo = asText(brief.visual && brief.visual.logo, 500);
  const sellingPoints = stringList(brief.selling_points, 4, 180);
  const trustSignals = stringList(brief.trust_signals, 3, 180);
  const collectionIntro = pageIntent(brief, "collection") || positioning;
  const productNote = pageIntent(brief, "product") || positioning;
  const heroText = tagline || positioning || brandName;

  const risks = [
    {
      id: "unpublished_only",
      message: "Upload uses shopify theme push --unpublished --json. The live theme is left unchanged.",
    },
    {
      id: "timeout_fallback",
      message:
        "If the upload exceeds 3.5 minutes (4 minute cap) or fails, apply attaches the documented Demo Theme and sets fallback_used=true.",
    },
    {
      id: "opening_soon",
      message:
        "An unauthenticated storefront shows Opening soon. Open the preview with shopify store open. Session URLs are not written by this step.",
    },
  ];
  if (primary.missing) {
    risks.push({
      id: "missing_primary_color",
      message: `Primary color is missing. The skeleton default ${DEFAULT_PRIMARY} will be used.`,
    });
  }
  if (primary.invalid) {
    risks.push({
      id: "invalid_primary_color",
      message: `Primary color is not a hex color. The skeleton default ${DEFAULT_PRIMARY} will be used.`,
    });
  }
  if (secondary.missing || secondary.invalid) {
    risks.push({
      id: "secondary_color_default",
      message: `Secondary color is missing or invalid. The skeleton default ${DEFAULT_SECONDARY} will be used.`,
    });
  }
  if (!logo) risks.push({ id: "empty_logo", message: "Logo is empty. The header will show the brand name." });
  if (!tagline) {
    risks.push({
      id: "empty_tagline",
      message: "Tagline is empty. The hero will use positioning when it is present.",
    });
  }
  const avoid = Array.isArray(brief.tone && brief.tone.avoid)
    ? brief.tone.avoid.filter((item) => typeof item === "string" && item.trim())
    : [];
  if (avoid.length > 0) {
    risks.push({
      id: "tone_avoid",
      message: "The brief lists tone.avoid. Filled copy is taken from the brief; confirm it before the unpublished upload.",
    });
  }

  const candidates = [
    ["tagline", tagline],
    ["positioning", positioning],
    ["collection_intro", collectionIntro],
    ["product_note", productNote],
    ...sellingPoints.map((text, index) => [`selling_points[${index}]`, text]),
    ...trustSignals.map((text, index) => [`trust_signals[${index}]`, text]),
  ];
  const riskyFields = candidates.filter(([, text]) => text && RISKY_COPY.test(text)).map(([field]) => field);
  if (riskyFields.length > 0) {
    risks.push({
      id: "risky_copy",
      message: `Filled copy includes medical or hype phrasing in ${riskyFields.join(", ")}.`,
      fields: riskyFields,
    });
  }

  return {
    brand_name: brandName,
    tagline,
    hero_text: heroText,
    positioning,
    primary_color: primary.color,
    secondary_color: secondary.color,
    logo,
    logo_set: Boolean(logo),
    selling_points: [0, 1, 2, 3].map((index) => sellingPoints[index] || ""),
    trust_signals: [0, 1, 2].map((index) => trustSignals[index] || ""),
    collection_intro: collectionIntro,
    product_note: productNote,
    selling_heading: `Why ${brandName}`.slice(0, 80),
    featured_heading: `Shop ${brandName}`.slice(0, 80),
    theme_name: `Workshop ${brandName}`.slice(0, 50),
    pages: [...PAGES],
    sections: [
      { page: "home", id: "hero", settings: ["heading", "text"] },
      { page: "home", id: "selling_points", settings: ["heading", "point_1", "point_2", "point_3", "point_4"] },
      { page: "home", id: "featured_collection", settings: ["heading"] },
      { page: "home", id: "trust", settings: ["heading", "trust_1", "trust_2", "trust_3"] },
      { page: "collection", id: "main", settings: ["intro"] },
      { page: "product", id: "main", settings: ["brand_note"] },
    ],
    risks,
    products_touched: false,
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  assertArtifactSafe(text);
  await fs.writeFile(filePath, text, "utf8");
  return text;
}

export async function fillSkeleton({ brief, skeletonDir, destDir, accessUrlForGuard = null }) {
  const summary = summarizeFill(brief);
  await fs.mkdir(path.dirname(destDir), { recursive: true, mode: 0o700 });
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.cp(skeletonDir, destDir, { recursive: true });

  const settingsData = await readJson(path.join(destDir, "config", "settings_data.json"));
  settingsData.current = {
    ...(settingsData.current || {}),
    brand_name: summary.brand_name,
    tagline: summary.tagline,
    positioning: summary.positioning,
    logo: summary.logo,
    color_primary: summary.primary_color,
    color_secondary: summary.secondary_color,
  };

  const schema = await readJson(path.join(destDir, "config", "settings_schema.json"));
  const info = schema.find((group) => group && group.name === "theme_info");
  if (info) info.theme_name = summary.theme_name;

  const index = await readJson(path.join(destDir, "templates", "index.json"));
  index.sections.hero.settings.heading = summary.brand_name;
  index.sections.hero.settings.text = summary.hero_text;
  index.sections.selling_points.settings.heading = summary.selling_heading;
  index.sections.selling_points.settings.point_1 = summary.selling_points[0];
  index.sections.selling_points.settings.point_2 = summary.selling_points[1];
  index.sections.selling_points.settings.point_3 = summary.selling_points[2];
  index.sections.selling_points.settings.point_4 = summary.selling_points[3];
  index.sections.featured_collection.settings.heading = summary.featured_heading;
  index.sections.trust.settings.heading = "Good to know";
  index.sections.trust.settings.trust_1 = summary.trust_signals[0];
  index.sections.trust.settings.trust_2 = summary.trust_signals[1];
  index.sections.trust.settings.trust_3 = summary.trust_signals[2];

  const collection = await readJson(path.join(destDir, "templates", "collection.json"));
  collection.sections.main.settings.intro = summary.collection_intro;

  const product = await readJson(path.join(destDir, "templates", "product.json"));
  product.sections.main.settings.brand_note = summary.product_note;

  const documents = [
    ["config/settings_data.json", settingsData],
    ["config/settings_schema.json", schema],
    ["templates/index.json", index],
    ["templates/collection.json", collection],
    ["templates/product.json", product],
  ];
  const combined = documents.map(([, value]) => JSON.stringify(value)).join("\n");
  assertNoRawAccessUrl(combined, accessUrlForGuard);

  for (const [relativePath, value] of documents) {
    await writeJson(path.join(destDir, relativePath), value);
  }
  return summary;
}
