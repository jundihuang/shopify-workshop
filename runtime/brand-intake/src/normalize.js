import { assertNoSensitiveKeys } from "./redact.js";
import { BASELINE_AVOID, collectRiskFlags, collectStringLeaves, mergeAvoid } from "./flags.js";

const DEFAULTS = Object.freeze({
  brand_name: "Workshop Brand",
  tagline: "Clear products for everyday use.",
  audience_primary: "Shoppers looking for a straightforward product",
  positioning: "A product brand described in specific, checkable language.",
  tone_voice: "clear, calm, and specific",
  primary_color: "#1F3A5F",
  secondary_color: "#F4F1EA",
  image_style: "clean product photography on a neutral background",
  selling_points: Object.freeze([
    "Specific materials or ingredients",
    "A clear use case",
    "Plain-language descriptions",
  ]),
  locale: "en-US",
  currency: "USD",
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value, field) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value.trim();
}

function stringList(value, field) {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") {
    return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings or a comma-separated string`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string") throw new Error(`${field}.${index} must be a string`);
    return item.trim();
  }).filter(Boolean);
}

function firstSentence(text, max = 90) {
  const trimmed = text.trim();
  const matched = trimmed.match(/^[\s\S]{1,90}?[.!?。！？](?=\s|$)/);
  const sentence = (matched ? matched[0] : trimmed).trim();
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1).trim()}…`;
}

function normalizeLocale(value) {
  const raw = optionalString(value, "locale");
  if (!raw) return { value: DEFAULTS.locale, defaulted: true };
  const bcp47 = raw.match(/^([a-zA-Z]{2})[-_]([a-zA-Z]{2})$/);
  if (bcp47) return { value: `${bcp47[1].toLowerCase()}-${bcp47[2].toUpperCase()}`, defaulted: false };
  return { value: raw, defaulted: false };
}

function normalizeCurrency(value) {
  const raw = optionalString(value, "currency");
  if (!raw) return { value: DEFAULTS.currency, defaulted: true };
  if (/^[a-zA-Z]{3}$/.test(raw)) return { value: raw.toUpperCase(), defaulted: false };
  return { value: raw, defaulted: false };
}

function readAudience(answers) {
  if (answers.audience === undefined || answers.audience === null || answers.audience === "") {
    return {
      primary: optionalString(answers.audience_primary ?? answers.primary_audience ?? answers.target_audience, "audience"),
      needs: stringList(answers.needs ?? answers.audience_needs, "needs"),
    };
  }
  if (typeof answers.audience === "string") {
    return {
      primary: answers.audience.trim(),
      needs: stringList(answers.needs ?? answers.audience_needs, "needs"),
    };
  }
  if (!isObject(answers.audience)) throw new Error("audience must be a string or an object");
  return {
    primary: optionalString(answers.audience.primary, "audience.primary"),
    needs: stringList(answers.audience.needs ?? answers.needs, "audience.needs"),
  };
}

function readTone(answers) {
  const sideAvoid = stringList(answers.avoid ?? answers.tone_avoid, "avoid");
  if (answers.tone === undefined || answers.tone === null || answers.tone === "") {
    return {
      voice: optionalString(answers.voice ?? answers.brand_tone, "tone"),
      avoid: sideAvoid,
    };
  }
  if (typeof answers.tone === "string") {
    return { voice: answers.tone.trim(), avoid: sideAvoid };
  }
  if (!isObject(answers.tone)) throw new Error("tone must be a string or an object");
  const nestedAvoid = stringList(answers.tone.avoid, "tone.avoid");
  return {
    voice: optionalString(answers.tone.voice, "tone.voice") || optionalString(answers.voice, "voice"),
    avoid: mergeAvoid(nestedAvoid, sideAvoid),
  };
}

function readVisual(answers) {
  const visual = answers.visual === undefined || answers.visual === null ? {} : answers.visual;
  if (!isObject(visual)) throw new Error("visual must be an object");
  return {
    logo: optionalString(visual.logo, "visual.logo") || optionalString(answers.logo ?? answers.logo_url, "logo"),
    primary_color: optionalString(visual.primary_color, "visual.primary_color")
      || optionalString(answers.primary_color ?? answers.color ?? answers.main_color, "primary_color"),
    secondary_color: optionalString(visual.secondary_color, "visual.secondary_color")
      || optionalString(answers.secondary_color, "secondary_color"),
    image_style: optionalString(visual.image_style, "visual.image_style")
      || optionalString(answers.image_style, "image_style"),
  };
}

export function buildPageIntents(brandName) {
  const name = brandName || DEFAULTS.brand_name;
  return {
    home: {
      intent: `Introduce ${name} and route shoppers to the collection.`,
      sections: [
        { id: "hero", intent: "Show brand_name, tagline, and primary_color." },
        { id: "selling_points", intent: "List selling_points as short claims, skipping anything in tone.avoid." },
        { id: "featured_collection", intent: "Surface the workshop collection." },
        { id: "trust", intent: "Show trust_signals without adding medical or hype claims." },
      ],
    },
    collection: {
      intent: `Help shoppers scan ${name} products against the audience.`,
      sections: [
        { id: "collection_header", intent: "Restate positioning in one sentence." },
        { id: "product_grid", intent: "Show title, price, and one selling point." },
      ],
    },
    product: {
      intent: "Explain one product with specific copy constrained by tone.avoid.",
      sections: [
        { id: "product_hero", intent: "Title, price, and primary image." },
        { id: "description", intent: "Use positioning and selling_points. Drop phrases listed in tone.avoid." },
        { id: "details", intent: "Materials, use, and trust_signals." },
      ],
    },
  };
}

function mergePages(provided, generated) {
  if (provided === undefined || provided === null) return generated;
  if (!isObject(provided)) throw new Error("pages must be an object");
  const pages = {};
  for (const key of ["home", "collection", "product"]) {
    if (provided[key] === undefined) {
      pages[key] = generated[key];
      continue;
    }
    if (!isObject(provided[key])) throw new Error(`pages.${key} must be an object of section intents`);
    pages[key] = provided[key];
  }
  return pages;
}

function pushMissing(missing, field, present) {
  if (!present) missing.push(field);
}

/**
 * Normalize flat or nested student answers into a schema-shaped brief.
 * Omitted locale/currency become en-US / USD and are not listed in missing[].
 * Other empty required inputs are filled with workshop defaults and listed in missing[].
 */
export function buildBriefFromAnswers(answers) {
  if (!isObject(answers)) throw new Error("Answers must be a JSON object");
  assertNoSensitiveKeys(answers);

  const description = optionalString(
    answers.description ?? answers.intro ?? answers.brand_intro ?? answers.about ?? answers.brand_description,
    "description",
  );
  let brandName = optionalString(answers.brand_name ?? answers.name, "brand_name");
  let tagline = optionalString(answers.tagline ?? answers.slogan, "tagline");
  let positioning = optionalString(answers.positioning, "positioning");
  const audience = readAudience(answers);
  const tone = readTone(answers);
  const visual = readVisual(answers);
  let sellingPoints = stringList(answers.selling_points ?? answers.points ?? answers.benefits, "selling_points");
  const trustSignals = stringList(answers.trust_signals, "trust_signals");
  const locale = normalizeLocale(answers.locale ?? answers.language);
  const currency = normalizeCurrency(answers.currency);

  const derived = [];
  if (!positioning && description) {
    positioning = description;
    derived.push({ field: "positioning", from: "description" });
  }
  if (!tagline) {
    const sourceText = description || positioning;
    if (sourceText) {
      tagline = firstSentence(sourceText);
      derived.push({ field: "tagline", from: description ? "description" : "positioning" });
    }
  }

  const riskFlags = collectRiskFlags(collectStringLeaves(answers));
  const missing = [];
  pushMissing(missing, "brand_name", brandName);
  pushMissing(missing, "tagline", tagline);
  pushMissing(missing, "audience.primary", audience.primary);
  pushMissing(missing, "positioning", positioning);
  pushMissing(missing, "tone.voice", tone.voice);
  pushMissing(missing, "visual.primary_color", visual.primary_color);
  pushMissing(missing, "selling_points", sellingPoints.length > 0);

  if (!brandName) brandName = DEFAULTS.brand_name;
  if (!tagline) tagline = DEFAULTS.tagline;
  if (!audience.primary) audience.primary = DEFAULTS.audience_primary;
  if (!positioning) positioning = DEFAULTS.positioning;
  if (!tone.voice) tone.voice = DEFAULTS.tone_voice;
  if (!visual.primary_color) visual.primary_color = DEFAULTS.primary_color;
  if (!visual.secondary_color) visual.secondary_color = DEFAULTS.secondary_color;
  if (!visual.image_style) visual.image_style = DEFAULTS.image_style;
  if (sellingPoints.length === 0) sellingPoints = [...DEFAULTS.selling_points];

  const brief = {
    brand_name: brandName,
    tagline,
    audience: {
      primary: audience.primary,
      needs: audience.needs,
    },
    positioning,
    tone: {
      voice: tone.voice,
      avoid: mergeAvoid(tone.avoid, [...riskFlags.map((flag) => flag.avoid), ...BASELINE_AVOID]),
    },
    visual: {
      primary_color: visual.primary_color,
      secondary_color: visual.secondary_color,
      image_style: visual.image_style,
    },
    selling_points: sellingPoints,
    trust_signals: trustSignals,
    pages: mergePages(answers.pages, buildPageIntents(brandName)),
    locale: locale.value,
    currency: currency.value,
    missing,
  };
  if (visual.logo) brief.visual.logo = visual.logo;

  return {
    brief,
    missing,
    risk_flags: riskFlags,
    derived,
    source: "answers",
  };
}

/**
 * Load the preset Aurora Skincare brief as-is.
 * Risk flags are appended to tone.avoid when the demo copy itself contains them.
 */
export function buildBriefFromDemo(demo) {
  if (!isObject(demo)) throw new Error("Demo brief must be a JSON object");
  assertNoSensitiveKeys(demo);
  const brief = structuredClone(demo);
  if (!Array.isArray(brief.missing)) brief.missing = [];
  const riskFlags = collectRiskFlags(collectStringLeaves(brief));
  if (!isObject(brief.tone)) brief.tone = {};
  brief.tone.avoid = mergeAvoid(brief.tone.avoid, riskFlags.map((flag) => flag.avoid));
  return {
    brief,
    missing: [...brief.missing],
    risk_flags: riskFlags,
    derived: [],
    source: "demo",
  };
}
