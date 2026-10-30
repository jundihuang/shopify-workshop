/**
 * Redact URL-shaped and obvious token/password values from diagnostics. Raw
 * access URLs are only ever intentionally emitted by the `info` command on
 * stdout; diagnostics must never preserve them.
 */
export function redactSensitiveText(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(/((?:access[_-]?url|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, 4000);
}
