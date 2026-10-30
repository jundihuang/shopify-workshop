const SENSITIVE_ASSIGNMENT = /\b(access[_-]?url|access[_-]?token|admin[_-]?token|api[_-]?token|token|secret|password)\b\s*[:=]\s*(?:https?:\/\/)?[^\s,;}"']+/gi;

export function redactSensitiveText(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(SENSITIVE_ASSIGNMENT, "$1=[REDACTED]")
    .slice(0, 4000);
}

/**
 * Runtime artifacts may contain product and store domains, but never session
 * credentials. Plan and result writers call this immediately before writing.
 */
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
