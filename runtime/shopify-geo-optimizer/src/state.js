function topLevelIndex(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:`);
  return lines.findIndex((line) => pattern.test(line));
}

const OPTIMIZER_STATUSES = new Set(["pending", "approved_p0_batch", "applied", "skipped"]);

/**
 * Update geo.after_score and geo.optimizer_status only.
 * before_score, evidence_mode, and restrictions stay untouched.
 */
export function updateOptimizerState(existingText, { afterScore, optimizerStatus }) {
  if (!Number.isInteger(afterScore) || afterScore < 0 || afterScore > 100) {
    throw new Error("geo.after_score must be an integer from 0 to 100");
  }
  if (!OPTIMIZER_STATUSES.has(optimizerStatus)) {
    throw new Error(`Unsupported geo.optimizer_status "${optimizerStatus}"`);
  }

  let text = typeof existingText === "string" ? existingText.replace(/\r\n/g, "\n") : "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  const lines = text.length > 0 ? text.slice(0, -1).split("\n") : [];
  const updates = {
    after_score: String(afterScore),
    optimizer_status: optimizerStatus,
  };

  let start = topLevelIndex(lines, "geo");
  if (start === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("geo:");
    for (const [key, value] of Object.entries(updates)) lines.push(`  ${key}: ${value}`);
  } else {
    let end = start + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim() !== "" && !/^\s/.test(line)) break;
      end += 1;
    }
    for (const [key, value] of Object.entries(updates)) {
      const pattern = new RegExp(`^  ${key}:`);
      const index = lines.findIndex((line, lineIndex) => lineIndex > start && lineIndex < end && pattern.test(line));
      if (index === -1) {
        lines.splice(end, 0, `  ${key}: ${value}`);
        end += 1;
      } else {
        lines[index] = `  ${key}: ${value}`;
      }
    }
  }

  const output = `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
  if (/access[_-]?url\s*:\s*https?:\/\//i.test(output)) {
    throw new Error("Refusing to write workshop-state.yaml with an accessUrl value");
  }
  return output;
}
