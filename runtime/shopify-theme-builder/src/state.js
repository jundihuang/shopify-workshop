const THEME_STATUSES = Object.freeze(["unpublished", "fallback"]);

function topLevelIndex(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:`);
  return lines.findIndex((line) => pattern.test(line));
}

function formatPreviewUrl(previewUrl) {
  if (typeof previewUrl !== "string" || !/^https:\/\/[a-z0-9][a-z0-9-]*\.myshopify\.com\/\?preview_theme_id=\d+$/.test(previewUrl)) {
    throw new Error("theme.preview_url must be https://{store}/?preview_theme_id={id}");
  }
  return JSON.stringify(previewUrl);
}

/**
 * Update only theme.theme_id, theme.status, theme.preview_url, and
 * theme.fallback_used. Connection, products, brand, GEO, and extra keys
 * already under theme stay as the other runtimes left them.
 */
export function updateThemeState(existingText, { themeId, status, previewUrl, fallbackUsed }) {
  if (!THEME_STATUSES.includes(status)) {
    throw new Error(`Unsupported theme.status "${status}"`);
  }
  if (!Number.isInteger(themeId) || themeId <= 0) {
    throw new Error("theme.theme_id must be a positive integer");
  }
  if (typeof fallbackUsed !== "boolean") {
    throw new Error("theme.fallback_used must be a boolean");
  }
  const preview = formatPreviewUrl(previewUrl);

  let text = typeof existingText === "string" ? existingText.replace(/\r\n/g, "\n") : "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  const lines = text.length > 0 ? text.slice(0, -1).split("\n") : [];

  const block = [
    "theme:",
    `  theme_id: ${themeId}`,
    `  status: ${status}`,
    `  preview_url: ${preview}`,
    `  fallback_used: ${fallbackUsed ? "true" : "false"}`,
  ];

  const start = topLevelIndex(lines, "theme");
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
    const preserved = lines.slice(start + 1, end).filter((line) => {
      if (line.trim() === "") return false;
      return !/^\s{2}(?:theme_id|status|preview_url|fallback_used)\s*:/.test(line);
    });
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
