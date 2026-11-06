export const BANNER_STATUSES = Object.freeze(["pending", "done", "restored", "skipped"]);

function topLevelIndex(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:`);
  return lines.findIndex((line) => pattern.test(line));
}

/**
 * Update only the `banner` section while preserving connection, products,
 * theme, geo, summary, and every other section written by the other Workshop
 * runtimes.
 */
export function updateBannerState(existingText, { status, themeId = null, imageRef = null, backupFile = null }) {
  if (!BANNER_STATUSES.includes(status)) {
    throw new Error(`Unsupported banner.status "${status}"`);
  }

  let text = typeof existingText === "string" ? existingText.replace(/\r\n/g, "\n") : "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  const lines = text.length > 0 ? text.slice(0, -1).split("\n") : [];

  const section = [
    "banner:",
    `  status: ${status}`,
    `  theme_id: ${themeId === null || themeId === undefined ? "null" : themeId}`,
    `  image_ref: ${imageRef === null || imageRef === undefined ? "null" : JSON.stringify(imageRef)}`,
    `  backup_file: ${backupFile === null || backupFile === undefined ? "null" : JSON.stringify(backupFile)}`,
    "  live_theme_modified: true",
  ];

  const start = topLevelIndex(lines, "banner");
  if (start === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("", ...section);
  } else {
    let end = start + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim() !== "" && !/^\s/.test(line)) break;
      end += 1;
    }
    lines.splice(start, end - start, ...section);
  }

  const output = `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
  if (/access[_-]?url\s*:\s*https?:\/\//i.test(output)) {
    throw new Error("Refusing to write workshop-state.yaml with an accessUrl value");
  }
  return output;
}
