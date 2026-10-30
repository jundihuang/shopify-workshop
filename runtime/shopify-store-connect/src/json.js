/**
 * Parse Shopify CLI JSON output. The CLI normally emits exactly one JSON
 * document with --json, but accepting a small amount of surrounding output
 * makes this tolerant of wrapper/plugin noise without ever logging raw data.
 */
export function extractJson(text) {
  if (typeof text !== "string") {
    throw new Error("Expected a string from the Shopify CLI");
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Shopify CLI returned empty output");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to scanning for the last complete top-level JSON value.
  }

  const starts = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{" || text[i] === "[") starts.push(i);
  }

  for (let i = 0; i < starts.length; i += 1) {
    const candidate = text.slice(starts[i]).trim();
    const end = findJsonEnd(candidate);
    if (end === -1) continue;
    try {
      return JSON.parse(candidate.slice(0, end + 1));
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Shopify CLI did not return valid JSON");
}

function findJsonEnd(text) {
  const opener = text[0];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}
