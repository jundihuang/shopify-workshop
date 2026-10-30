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
  if (/passwordProtectionUpdate/i.test(text)) {
    throw new Error("Refusing to write an artifact that names a storefront password mutation");
  }
  return text;
}

export function assertNoSensitiveKeys(value, label = "artifact", trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, label, [...trail, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      const field = [...trail, key].join(".");
      throw new Error(
        `Refusing ${label} field ${field}: workshop artifacts never accept accessUrl, tokens, or passwords`,
      );
    }
    assertNoSensitiveKeys(child, label, [...trail, key]);
  }
}

export function assertNoRawAccessUrl(serialized, accessUrl) {
  const text = assertArtifactSafe(serialized);
  if (accessUrl && typeof accessUrl === "string" && accessUrl.length > 0 && text.includes(accessUrl)) {
    throw new Error("Refusing to write an artifact containing a raw accessUrl");
  }
  return text;
}
