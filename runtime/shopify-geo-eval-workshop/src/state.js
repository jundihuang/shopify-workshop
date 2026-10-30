const EVIDENCE_MODES = new Set(["hybrid_admin_preview", "admin_only"]);
const OWNED_GEO_KEYS = new Set(["evidence_mode", "before_score", "restrictions"]);

function topLevelIndex(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:`);
  return lines.findIndex((line) => pattern.test(line));
}

function sectionBody(text, name) {
  const source = `${String(text || "").replace(/\s*$/, "")}\n`;
  // `$` is not used alone: with the m flag it would match every line ending.
  const match = source.match(new RegExp(`^${name}:\\n([\\s\\S]*?)\\n(?=[^\\s\\n]|$)`, "m"));
  return match ? match[1] : "";
}

function scalar(block, key) {
  const match = block.match(new RegExp(`^  ${key}:\\s*(.*)$`, "m"));
  if (!match) return null;
  let value = match[1].trim();
  if (value === "" || value === "null" || value === "~" || value === "|" || value === ">") return null;
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

/**
 * Read the few workshop-state fields GEO needs. Does not interpret secrets.
 */
export function readWorkshopFacts(existingText) {
  const text = String(existingText || "");
  const domainMatch = text.match(/^store_domain:\s*(.+)$/m);
  let storeDomain = domainMatch ? domainMatch[1].trim() : null;
  if (storeDomain && ((storeDomain.startsWith('"') && storeDomain.endsWith('"')) || (storeDomain.startsWith("'") && storeDomain.endsWith("'")))) {
    storeDomain = storeDomain.slice(1, -1);
  }
  if (storeDomain === "null") storeDomain = null;
  return {
    storeDomain,
    channelStatus: scalar(sectionBody(text, "products"), "channel_status"),
    previewUrl: scalar(sectionBody(text, "theme"), "preview_url"),
    storefrontSession: scalar(sectionBody(text, "connection"), "storefront_session"),
  };
}

function geoBlock(evidenceMode, beforeScore, restrictions) {
  const lines = [
    "geo:",
    `  evidence_mode: ${evidenceMode}`,
    `  before_score: ${beforeScore}`,
  ];
  if (restrictions.length === 0) {
    lines.push("  restrictions: []");
  } else {
    lines.push("  restrictions:");
    for (const item of restrictions) lines.push(`    - ${item}`);
  }
  return lines;
}

/**
 * Update only geo.evidence_mode, geo.before_score, and geo.restrictions.
 * Connection, products, brand, theme, after_score, and optimizer_status stay
 * as the other runtimes left them.
 */
export function updateGeoBeforeState(existingText, { beforeScore, evidenceMode, restrictions }) {
  if (!Number.isInteger(beforeScore) || beforeScore < 0 || beforeScore > 100) {
    throw new Error("geo.before_score must be an integer from 0 to 100");
  }
  if (!EVIDENCE_MODES.has(evidenceMode)) {
    throw new Error(`Unsupported geo.evidence_mode "${evidenceMode}"`);
  }
  if (!Array.isArray(restrictions) || restrictions.some((item) => typeof item !== "string" || !/^[a-z0-9_]+$/.test(item))) {
    throw new Error("geo.restrictions must be a list of restriction ids");
  }

  let text = typeof existingText === "string" ? existingText.replace(/\r\n/g, "\n") : "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  const lines = text.length > 0 ? text.slice(0, -1).split("\n") : [];
  const block = geoBlock(evidenceMode, beforeScore, restrictions);

  const start = topLevelIndex(lines, "geo");
  if (start === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push(...block);
  } else {
    let end = start + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim() !== "" && !/^\s/.test(line)) break;
      end += 1;
    }
    const preserved = [];
    let skippingRestrictions = false;
    for (const line of lines.slice(start + 1, end)) {
      const keyMatch = line.match(/^  ([A-Za-z0-9_]+)\s*:/);
      if (keyMatch) {
        skippingRestrictions = keyMatch[1] === "restrictions";
        if (OWNED_GEO_KEYS.has(keyMatch[1])) continue;
        preserved.push(line);
        skippingRestrictions = false;
        continue;
      }
      if (skippingRestrictions && (/^    - /.test(line) || line.trim() === "")) continue;
      skippingRestrictions = false;
      if (line.trim() === "") continue;
      preserved.push(line);
    }
    const replacement = [...block, ...preserved];
    if (end < lines.length) replacement.push("");
    lines.splice(start, end - start, ...replacement);
  }

  const output = `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
  if (/access[_-]?url\s*:\s*https?:\/\//i.test(output)) {
    throw new Error("Refusing to write workshop-state.yaml with an accessUrl value");
  }
  return output;
}
