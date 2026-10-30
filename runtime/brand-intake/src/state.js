export const BRAND_STATUSES = Object.freeze(["pending", "done", "fallback_demo"]);
export const BRIEF_FILE_NAME = "brand-brief.json";

function topLevelIndex(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:`);
  return lines.findIndex((line) => pattern.test(line));
}

/**
 * Update only brand.brief_file and brand.status. Connection, products, theme,
 * GEO, and any extra keys already under brand stay as the other runtimes left them.
 */
export function updateBrandState(existingText, { briefFile = BRIEF_FILE_NAME, status }) {
  if (!BRAND_STATUSES.includes(status) || status === "pending") {
    throw new Error(`Unsupported brand.status "${status}"`);
  }
  if (briefFile !== BRIEF_FILE_NAME) {
    throw new Error(`brand.brief_file must be ${BRIEF_FILE_NAME}`);
  }

  let text = typeof existingText === "string" ? existingText.replace(/\r\n/g, "\n") : "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  const lines = text.length > 0 ? text.slice(0, -1).split("\n") : [];

  const start = topLevelIndex(lines, "brand");
  if (start === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("brand:", `  brief_file: ${briefFile}`, `  status: ${status}`);
  } else {
    let end = start + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim() !== "" && !/^\s/.test(line)) break;
      end += 1;
    }
    const preserved = lines.slice(start + 1, end).filter((line) => {
      if (line.trim() === "") return false;
      return !/^\s{2}(?:brief_file|status)\s*:/.test(line);
    });
    const replacement = ["brand:", `  brief_file: ${briefFile}`, `  status: ${status}`, ...preserved];
    if (end < lines.length) replacement.push("");
    lines.splice(start, end - start, ...replacement);
  }

  const output = `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
  if (/access[_-]?url\s*:\s*https?:\/\//i.test(output)) {
    throw new Error("Refusing to write workshop-state.yaml with an accessUrl value");
  }
  return output;
}
