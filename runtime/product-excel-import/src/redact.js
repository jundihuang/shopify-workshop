const SENSITIVE_KEY = /^(?:access[_-]?url|access[_-]?token|admin[_-]?token|api[_-]?token|token|secret|password)$/i;
const SENSITIVE_ASSIGNMENT = /\b(access[_-]?url|access[_-]?token|admin[_-]?token|api[_-]?token|token|secret|password)\b\s*[:=]\s*(?:https?:\/\/)?[^\s,;}"']+/gi;

export function redactSensitiveText(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(SENSITIVE_ASSIGNMENT, "$1=[REDACTED]")
    .slice(0, 4000);
}

export function assertArtifactSafe(serialized) {
  const text = String(serialized);
  if (/"(?:access[_-]?url|access[_-]?token|admin[_-]?token|api[_-]?token|token|secret|password)"\s*:/i.test(text)) {
    throw new Error("Refusing to write an artifact containing a sensitive credential field");
  }
  if (/\baccess[_-]?url\s*[:=]\s*https?:\/\//i.test(text)) {
    throw new Error("Refusing to write an artifact containing a raw accessUrl");
  }
  return text;
}

export function findSensitiveValues(value, path = [], output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSensitiveValues(item, [...path, String(index)], output));
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key) && typeof child === "string" && child.trim()) output.push(child.trim());
      findSensitiveValues(child, [...path, key], output);
    }
  }
  return output;
}
