/**
 * Pure helpers for editing a Horizon `templates/index.json` homepage template.
 * Horizon JSON templates may start with a `/* ... *​/` comment header that must
 * be stripped before JSON.parse, and the hero section key is randomly suffixed
 * (e.g. `hero_jVaWmY`), so it is located by section type via `order`.
 */

export const HOMEPAGE_TEMPLATE = "templates/index.json";

export function stripTemplateComment(text) {
  return String(text ?? "").replace(/^\/\*[\s\S]*?\*\/\s*/, "");
}

export function parseTemplateJson(text) {
  try {
    return JSON.parse(stripTemplateComment(text));
  } catch (error) {
    throw new Error(`Homepage template is not valid JSON after stripping the comment header: ${error.message}`);
  }
}

/**
 * Find the first homepage section whose type is `hero` (Horizon's homepage
 * banner). Returns `{ key, section }`. Throws when absent so a changed theme
 * structure fails loudly instead of silently skipping the banner.
 */
export function findHeroSection(indexObject) {
  const order = Array.isArray(indexObject?.order) ? indexObject.order : [];
  const sections = indexObject?.sections && typeof indexObject.sections === "object" ? indexObject.sections : {};
  for (const key of order) {
    const section = sections[key];
    if (section && typeof section.type === "string" && section.type.split("__")[0] === "hero") {
      return { key, section };
    }
  }
  throw new Error(
    "No hero section found on the Horizon homepage (expected a section of type 'hero' in templates/index.json). " +
      "The theme structure may have changed; install the banner manually from the theme editor.",
  );
}

/**
 * Shopify image_picker settings inside JSON templates must reference store
 * files with the `shopify://shop_images/<filename>` protocol. Raw CDN URLs
 * (with or without `?v=`) are rejected by themeFilesUpsert with
 * "does not point to an applicable resource".
 */
export function buildImageRef(cdnUrl) {
  const raw = String(cdnUrl ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(`Expected an https image URL, got: ${raw.slice(0, 80)}`);
  }
  const withoutQuery = raw.split("?")[0];
  const filename = withoutQuery.split("/").pop();
  if (!filename || !/\.(jpe?g|png|webp|gif|avif)$/i.test(filename)) {
    throw new Error(`Cannot derive an image filename from URL: ${raw.slice(0, 80)}`);
  }
  return `shopify://shop_images/${filename}`;
}

/**
 * Return a copy of the homepage template object with the hero's `image_1`
 * setting set to `imageRef`. Does not mutate the input.
 */
export function withHeroBannerImage(indexObject, heroKey, imageRef) {
  const next = JSON.parse(JSON.stringify(indexObject));
  const section = next.sections?.[heroKey];
  if (!section) throw new Error(`Hero section "${heroKey}" disappeared while editing.`);
  section.settings = { ...(section.settings ?? {}), image_1: imageRef };
  return next;
}

export function heroBannerState(indexObject, heroKey) {
  const section = indexObject?.sections?.[heroKey];
  const value = section?.settings?.image_1;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Return a copy of the homepage template with the hero's first text block and
 * first button block updated. `heading` keeps simple HTML wrapping (<p>) like
 * the theme editor produces; pass plain text and it is wrapped automatically.
 * Null/undefined fields are left untouched. Does not mutate the input.
 */
export function withHeroCopy(indexObject, heroKey, { heading, buttonLabel } = {}) {
  const next = JSON.parse(JSON.stringify(indexObject));
  const hero = next.sections?.[heroKey];
  if (!hero) throw new Error(`Hero section "${heroKey}" disappeared while editing.`);
  const blocks = hero.blocks && typeof hero.blocks === "object" ? hero.blocks : {};

  if (typeof heading === "string" && heading.trim()) {
    const textKey = Object.keys(blocks).find((key) => blocks[key]?.type === "text");
    if (!textKey) throw new Error("Hero has no text block to hold the heading copy.");
    const wrapped = /<[a-z][\s\S]*>/i.test(heading) ? heading : `<p>${heading}</p>`;
    blocks[textKey].settings = { ...(blocks[textKey].settings ?? {}), text: wrapped };
  }

  if (typeof buttonLabel === "string" && buttonLabel.trim()) {
    const buttonKey = Object.keys(blocks).find((key) => blocks[key]?.type === "button");
    if (!buttonKey) throw new Error("Hero has no button block to relabel.");
    blocks[buttonKey].settings = { ...(blocks[buttonKey].settings ?? {}), label: buttonLabel };
  }

  return next;
}

export function heroCopyState(indexObject, heroKey) {
  const hero = indexObject?.sections?.[heroKey];
  const blocks = hero?.blocks && typeof hero.blocks === "object" ? hero.blocks : {};
  const textKey = Object.keys(blocks).find((key) => blocks[key]?.type === "text");
  const buttonKey = Object.keys(blocks).find((key) => blocks[key]?.type === "button");
  return {
    heading: textKey ? blocks[textKey].settings?.text ?? null : null,
    button_label: buttonKey ? blocks[buttonKey].settings?.label ?? null : null,
  };
}
