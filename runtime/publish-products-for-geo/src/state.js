export const CHANNEL_STATUSES = Object.freeze(["draft", "online_store_active"]);

function topLevelIndex(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:`);
  return lines.findIndex((line) => pattern.test(line));
}

/**
 * Update only products.channel_status while preserving connection, theme, GEO,
 * and every other section written by the other Workshop runtimes.
 */
export function updateProductsChannelStatus(existingText, { channelStatus }) {
  if (!CHANNEL_STATUSES.includes(channelStatus)) {
    throw new Error(`Unsupported products.channel_status "${channelStatus}"`);
  }

  let text = typeof existingText === "string" ? existingText.replace(/\r\n/g, "\n") : "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  const lines = text.length > 0 ? text.slice(0, -1).split("\n") : [];

  const start = topLevelIndex(lines, "products");
  if (start === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("products:", `  channel_status: ${channelStatus}`);
  } else {
    let end = start + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim() !== "" && !/^\s/.test(line)) break;
      end += 1;
    }
    const channelIndex = lines.findIndex(
      (line, index) => index > start && index < end && /^\s{2}channel_status\s*:/.test(line),
    );
    if (channelIndex === -1) {
      let insertAt = end;
      while (insertAt > start + 1 && lines[insertAt - 1] === "") insertAt -= 1;
      lines.splice(insertAt, 0, `  channel_status: ${channelStatus}`);
    } else {
      lines[channelIndex] = `  channel_status: ${channelStatus}`;
    }
  }

  const output = `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
  if (/access[_-]?url\s*:\s*https?:\/\//i.test(output)) {
    throw new Error("Refusing to write workshop-state.yaml with an accessUrl value");
  }
  return output;
}
