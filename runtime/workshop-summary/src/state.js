const SUMMARY_STATUSES = new Set(["done", "demo"]);

function topLevelIndex(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:`);
  return lines.findIndex((line) => pattern.test(line));
}

function sectionBody(text, name) {
  const source = `${String(text || "").replace(/\s*$/, "")}\n`;
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

function parseCount(value) {
  if (value === null || value === undefined) return null;
  if (!/^\d+$/.test(String(value))) return null;
  return Number(value);
}

function parseScore(value) {
  const score = parseCount(value);
  if (score === null || score > 100) return null;
  return score;
}

function restrictionList(block) {
  const lines = String(block || "").split("\n");
  const items = [];
  let inList = false;
  for (const line of lines) {
    if (/^  restrictions:/.test(line)) {
      inList = true;
      const inline = line.slice(line.indexOf(":") + 1).trim();
      if (inline === "[]") return [];
      continue;
    }
    if (!inList) continue;
    if (/^  [A-Za-z0-9_]+:/.test(line)) break;
    const item = line.match(/^    - ([a-z0-9_]+)\s*$/);
    if (item) items.push(item[1]);
  }
  return items;
}

function unquoteDomain(value) {
  if (!value) return null;
  let domain = value.trim();
  if (
    (domain.startsWith('"') && domain.endsWith('"'))
    || (domain.startsWith("'") && domain.endsWith("'"))
  ) {
    domain = domain.slice(1, -1);
  }
  if (domain === "null" || domain === "") return null;
  return domain;
}

/**
 * Read the workshop-state fields the summary can fall back to.
 * Does not interpret secrets.
 */
export function readWorkshopFacts(existingText) {
  const text = String(existingText || "");
  const domainMatch = text.match(/^store_domain:\s*(.+)$/m);
  const products = sectionBody(text, "products");
  const brand = sectionBody(text, "brand");
  const theme = sectionBody(text, "theme");
  const geo = sectionBody(text, "geo");
  const connection = sectionBody(text, "connection");
  return {
    storeDomain: unquoteDomain(domainMatch ? domainMatch[1] : null),
    connectionStatus: scalar(connection, "status"),
    storeType: scalar(connection, "store_type"),
    storefrontSession: scalar(connection, "storefront_session"),
    imported: parseCount(scalar(products, "imported")),
    failed: parseCount(scalar(products, "failed")),
    channelStatus: scalar(products, "channel_status"),
    brandStatus: scalar(brand, "status"),
    themeId: parseCount(scalar(theme, "theme_id")),
    themeStatus: scalar(theme, "status"),
    previewUrl: scalar(theme, "preview_url"),
    fallbackUsed: scalar(theme, "fallback_used"),
    evidenceMode: scalar(geo, "evidence_mode"),
    beforeScore: parseScore(scalar(geo, "before_score")),
    afterScore: parseScore(scalar(geo, "after_score")),
    optimizerStatus: scalar(geo, "optimizer_status"),
    restrictions: restrictionList(geo),
  };
}

function yamlNumberOrNull(value, label) {
  if (value === null || value === undefined) return "null";
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer or null`);
  }
  return String(value);
}

function summaryLines({ status, beforeScore, afterScore, improvement }) {
  if (!SUMMARY_STATUSES.has(status)) {
    throw new Error(`Unsupported summary.status "${status}"`);
  }
  return [
    "summary:",
    `  status: ${status}`,
    "  markdown: workshop-summary.md",
    "  html: workshop-summary.html",
    "  json: workshop-summary.json",
    `  before_score: ${yamlNumberOrNull(beforeScore, "summary.before_score")}`,
    `  after_score: ${yamlNumberOrNull(afterScore, "summary.after_score")}`,
    `  improvement: ${yamlNumberOrNull(improvement, "summary.improvement")}`,
  ];
}

/**
 * Replace the summary: block. Connection, products, brand, theme, geo, and qa
 * stay as the other runtimes left them.
 */
export function updateSummaryState(existingText, values) {
  const block = summaryLines(values);
  let text = typeof existingText === "string" ? existingText.replace(/\r\n/g, "\n") : "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  const lines = text.length > 0 ? text.slice(0, -1).split("\n") : [];

  const start = topLevelIndex(lines, "summary");
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
    const replacement = [...block];
    if (end < lines.length) replacement.push("");
    lines.splice(start, end - start, ...replacement);
  }

  const output = `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
  if (/access[_-]?url\s*:\s*https?:\/\//i.test(output)) {
    throw new Error("Refusing to write workshop-state.yaml with an accessUrl value");
  }
  if (/passwordProtectionUpdate/i.test(output)) {
    throw new Error("Refusing to write workshop-state.yaml that names a storefront password mutation");
  }
  return output;
}
