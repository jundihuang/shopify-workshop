/**
 * Thin field copy for the workshop optimizer.
 * Text comes from the brand brief (category, selling points, scene) and is
 * filtered against tone.avoid plus a small medical/hype list. This is not a
 * copywriting engine and it does not score the store.
 */

const BANNED_SOURCES = [
  "\\bcures?\\b",
  "\\bheal(?:s|ed|ing)?\\b",
  "\\bdiagnos(?:e|is|tic)\\b",
  "\\bclinically\\s+proven\\b",
  "\\bFDA[-\\s]?approved\\b",
  "\\bmedical[-\\s]?grade\\b",
  "\\bprescription\\b",
  "\\bdiseases?\\b",
  "\\bmiracles?\\b",
  "\\bguarantee[ds]?\\b",
  "\\bovernight(?:\\s+results?)?\\b",
  "\\b100\\s*%\\s*(?:effective|guaranteed)\\b",
  "\\bworld'?s\\s+best\\b",
  "治愈|根治|治疗",
  "临床证明|临床验证|医学级|医用",
  "神器|全网第一",
];

function collapse(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function avoidPhrases(avoid) {
  const phrases = [];
  const list = Array.isArray(avoid) ? avoid : [];
  for (const entry of list) {
    const text = collapse(entry);
    if (!text) continue;
    const quoted = text.match(/"([^"]+)"|'([^']+)'/g) || [];
    for (const raw of quoted) phrases.push(raw.slice(1, -1).trim());
    if (text.length <= 48) phrases.push(text);
  }
  return [...new Set(phrases.map((item) => collapse(item)).filter((item) => item.length >= 2))];
}

export function containsBanned(text) {
  return new RegExp(BANNED_SOURCES.join("|"), "i").test(String(text || ""));
}

export function sanitizeCopy(text, avoid = []) {
  let value = collapse(text);
  for (const phrase of avoidPhrases(avoid)) {
    value = value.replace(new RegExp(escapeRegExp(phrase), "gi"), " ");
  }
  value = value.replace(new RegExp(BANNED_SOURCES.join("|"), "gi"), " ");
  return collapse(value).replace(/\s+([,.])/g, "$1").replace(/([,;])\s*\1+/g, "$1").trim();
}

export function usablePoints(points, avoid) {
  const result = [];
  const list = Array.isArray(points) ? points : [];
  for (const point of list) {
    const original = collapse(point);
    if (!original) continue;
    if (containsBanned(original)) continue;
    if (avoidPhrases(avoid).some((phrase) => original.toLowerCase().includes(phrase.toLowerCase()))) continue;
    const cleaned = sanitizeCopy(original, avoid);
    if (cleaned.length < 8) continue;
    result.push(cleaned);
  }
  return result;
}

export function readConstraints(brief) {
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
    throw new Error("brand-brief.json must be an object");
  }
  const avoid = Array.isArray(brief.tone?.avoid) ? brief.tone.avoid.map((item) => String(item)) : [];
  const brand = sanitizeCopy(brief.brand_name || "Workshop brand", avoid) || "Workshop brand";
  let category = sanitizeCopy(brief.category || brief.product_category || "", avoid);
  let scene = sanitizeCopy(brief.scene || brief.use_scene || brief.audience?.primary || "", avoid);
  if (!category) category = "product";
  if (!scene) scene = "everyday use";
  return {
    brand,
    category,
    scene,
    sellingPoints: usablePoints(brief.selling_points, avoid),
    avoid,
  };
}

export function humanizeHandle(handle) {
  return collapse(String(handle || "").replace(/[-_]+/g, " "));
}

export function shorten(text, max) {
  const value = collapse(text);
  if (value.length <= max) return value;
  const slice = value.slice(0, max);
  const space = slice.lastIndexOf(" ");
  const cut = space >= 8 ? slice.slice(0, space) : slice;
  return cut.trim();
}

export function fitText(text, { min, max }) {
  let value = collapse(text);
  if (!value) return "";
  if (value.length > max) {
    const slice = value.slice(0, max);
    const space = slice.lastIndexOf(" ");
    value = (space >= Math.min(min, Math.max(8, max - 12)) ? slice.slice(0, space) : slice).trim();
    if (value.length > max) value = value.slice(0, max).trim();
  }
  if (value.length < min) {
    const pad = value;
    while (value.length < min && pad) {
      const next = `${value} ${pad}`.trim();
      if (next.length > max) {
        const room = max - value.length - 1;
        if (room <= 0) break;
        const extra = shorten(pad, room);
        if (!extra) break;
        value = `${value} ${extra}`.trim();
        break;
      }
      value = next;
    }
  }
  if (value.length > max) return fitText(value.slice(0, max), { min: Math.min(min, max), max });
  return value;
}

function includesTerm(haystack, term) {
  if (!term) return true;
  return haystack.toLowerCase().includes(term.toLowerCase());
}

export function fieldCopies({ handle, constraints }) {
  const { brand, category, scene, sellingPoints, avoid } = constraints;
  const name = humanizeHandle(handle) || category;
  const sceneShort = shorten(scene, 48);
  const categoryShort = shorten(category, 32);
  const point = sellingPoints[0] || "";
  const point2 = sellingPoints[1] || "";

  let core = `${brand} ${name}`;
  if (!includesTerm(core, categoryShort)) core = `${core} ${categoryShort}`;
  core = sanitizeCopy(`${core} for ${sceneShort}`, avoid);

  const title = fitText(core, { min: 12, max: 70 });

  const lead = sanitizeCopy(
    [
      `${brand} ${name} is a ${categoryShort} for ${sceneShort}.`,
      point ? `${point}.` : "",
      point2 ? `${point2}.` : "",
    ].filter(Boolean).join(" "),
    avoid,
  );
  const description = sanitizeCopy(
    `${lead} Details stay limited to the category, one selling point, and the scene.`,
    avoid,
  );

  const metaTitle = fitText(core, { min: 50, max: 65 });
  const metaDescription = fitText(sanitizeCopy(`${lead} Plain care notes.`, avoid), { min: 140, max: 160 });
  const keyAttributes = sanitizeCopy(
    `category: ${categoryShort}; scene: ${sceneShort}; point: ${point || categoryShort}`,
    avoid,
  );

  return {
    title,
    description,
    meta_title: metaTitle,
    meta_description: metaDescription,
    key_attributes: keyAttributes,
    faq: sanitizeCopy(`What is this ${categoryShort} for? It is for ${sceneShort}.`, avoid),
    image_alt: sanitizeCopy(`${brand} ${name} ${categoryShort}`, avoid),
  };
}

export function attributeWrite(constraints) {
  const productType = shorten(sanitizeCopy(constraints.category, constraints.avoid), 80) || "product";
  const tags = [];
  for (const source of [constraints.category, constraints.scene, ...constraints.sellingPoints]) {
    const tag = sanitizeCopy(source, constraints.avoid)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= 5) break;
  }
  return { productType, tags };
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
