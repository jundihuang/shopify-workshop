import { sanitizeCopy } from "./copy.js";

const KNOWN_FIELDS = new Set([
  "title",
  "description",
  "meta_title",
  "meta_description",
  "key_attributes",
  "faq",
  "image_alt",
]);

function uniqueHandles(handles) {
  const list = [];
  for (const handle of handles || []) {
    const value = String(handle || "").trim();
    if (!value || list.includes(value)) continue;
    list.push(value);
  }
  return list;
}

function cleanAfter(item, avoid) {
  const after = sanitizeCopy(item.after, avoid);
  if (!after) {
    throw new Error(`Refusing to write an empty after value for ${item.handle || "product"} ${item.field || "field"}.`);
  }
  return after;
}

export function approveAllP0(proposal, { deepReviewHandles = [], ignored = [], avoid = [] } = {}) {
  if (!proposal || !Array.isArray(proposal.suggestions)) {
    throw new Error("Refusing to write without an approved set.");
  }
  const handles = uniqueHandles(deepReviewHandles);
  if (handles.length > 2) {
    throw new Error(
      "Deep review is limited to 1–2 products. Approve the P0 batch with --approve-all-p0 and leave the other products in that batch.",
    );
  }
  const knownHandles = new Set(proposal.suggestions.map((item) => item.handle));
  for (const handle of handles) {
    if (!knownHandles.has(handle)) {
      throw new Error(`No proposal suggestions for deep-review handle ${handle}.`);
    }
  }

  const ignoreKeys = [];
  for (const raw of ignored || []) {
    const key = String(raw || "").trim();
    const splitAt = key.indexOf(":");
    if (splitAt <= 0) throw new Error(`--ignore must look like handle:field, received "${key}".`);
    const handle = key.slice(0, splitAt);
    const field = key.slice(splitAt + 1);
    if (!handles.includes(handle)) {
      throw new Error(`Refusing to ignore ${key} outside a deep-reviewed product.`);
    }
    if (!KNOWN_FIELDS.has(field)) throw new Error(`Unknown field in --ignore ${key}.`);
    ignoreKeys.push(`${handle}:${field}`);
  }
  const ignoredSet = new Set(ignoreKeys);

  const suggestions = [];
  for (const item of proposal.suggestions) {
    if (item.priority !== "P0" || item.batch !== true) continue;
    if (ignoredSet.has(`${item.handle}:${item.field}`)) continue;
    suggestions.push({
      ...item,
      after: cleanAfter(item, avoid),
      priority: "P0",
      batch: true,
      collapsed: false,
    });
  }
  if (suggestions.length === 0) {
    throw new Error("Refusing to write without an approved set.");
  }

  return {
    ok: true,
    artifact: "geo.approved.json",
    schema_version: "1.0",
    skill: "shopify-geo-optimizer",
    source_skill: "shopify-geo-eval-workshop",
    group_id: proposal.group_id,
    store: proposal.store,
    store_type: "preview",
    mode: "approve_all_p0",
    deep_review_handles: handles,
    ignored: [...ignoredSet],
    line_by_line_review: false,
    suggestions,
  };
}

export function acceptApprovedFile(doc, avoid = []) {
  if (!doc || !Array.isArray(doc.suggestions) || doc.suggestions.length === 0) {
    throw new Error("Refusing to write without an approved set.");
  }
  const suggestions = doc.suggestions.map((item) => {
    if (!item || item.priority !== "P0") {
      throw new Error("Refusing to write a non-P0 suggestion. Leave P1 collapsed and approve P0 in one batch.");
    }
    if (!KNOWN_FIELDS.has(item.field)) {
      throw new Error(`Approved set contains an unsupported field ${item.field}.`);
    }
    return {
      ...item,
      after: cleanAfter(item, avoid),
      priority: "P0",
      batch: true,
      collapsed: false,
    };
  });
  return {
    ...doc,
    ok: true,
    artifact: "geo.approved.json",
    skill: "shopify-geo-optimizer",
    source_skill: doc.source_skill || "shopify-geo-eval-workshop",
    mode: doc.mode || "approved_file",
    line_by_line_review: false,
    suggestions,
  };
}
