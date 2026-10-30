/**
 * Exaggerated and medical-claim phrasing that brand copy must not repeat.
 * Matches are copied into tone.avoid so theme fill and GEO copy can refuse them.
 */
export const RISK_PATTERNS = Object.freeze([
  { kind: "medical", id: "cure", re: /\bcures?\b|\bcured\b/i },
  { kind: "medical", id: "heal", re: /\bheal(?:s|ed|ing)?\b/i },
  { kind: "medical", id: "clinically_proven", re: /\bclinically\s+proven\b/i },
  { kind: "medical", id: "fda_approved", re: /\bFDA[-\s]?approved\b/i },
  { kind: "medical", id: "medical_grade", re: /\bmedical[-\s]grade\b/i },
  { kind: "medical", id: "diagnose", re: /\bdiagnos(?:e|is|tic)\b/i },
  { kind: "medical", id: "prescription", re: /\bprescription\b/i },
  { kind: "medical", id: "disease", re: /\bdiseases?\b/i },
  { kind: "medical", id: "zh_cure", re: /治愈|根治|治疗/ },
  { kind: "medical", id: "zh_clinical", re: /临床证明|临床验证|医学级|医用/ },
  { kind: "hype", id: "miracle", re: /\bmiracles?\b/i },
  { kind: "hype", id: "guaranteed", re: /\bguarantee[ds]?\b/i },
  { kind: "hype", id: "hundred_percent", re: /\b100\s*%\s*(?:effective|guaranteed|success|cure)/i },
  { kind: "hype", id: "overnight", re: /\bovernight\b/i },
  { kind: "hype", id: "instant_results", re: /\binstant(?:ly)?\s+results?\b/i },
  {
    kind: "hype",
    id: "number_one",
    // `#1` must not match the leading digits of a hex color such as #1F4E5F.
    re: /(?:#\s*1\b|\bno\.?\s*1\b|\bnumber\s+one\b|\bworld'?s\s+best\b|\bbest\s+in\s+the\s+world\b)/i,
  },
  { kind: "hype", id: "zh_hype", re: /永久有效|彻底解决|彻底根治|神器|全网第一|100%\s*有效/ },
]);

export const BASELINE_AVOID = Object.freeze([
  "medical claims (cure, heal, diagnose, clinically proven, FDA-approved, medical-grade)",
  "hype or guarantees (miracle, guaranteed, overnight results, 100% effective, world's best)",
]);

const SKIP_KEYS = new Set(["avoid", "tone_avoid"]);

function avoidLine(flag) {
  const label = flag.kind === "medical" ? "medical claim" : "hype";
  return `${label}: "${flag.phrase}" (${flag.field})`;
}

export function collectRiskFlags(leaves) {
  const flags = [];
  const seen = new Set();
  for (const leaf of leaves) {
    const text = typeof leaf.text === "string" ? leaf.text : "";
    if (!text.trim()) continue;
    for (const pattern of RISK_PATTERNS) {
      const match = text.match(pattern.re);
      if (!match) continue;
      const phrase = match[0].replace(/\s+/g, " ").trim();
      const field = leaf.field || "(root)";
      const key = `${pattern.kind}:${phrase.toLowerCase()}:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const flag = { kind: pattern.kind, id: pattern.id, phrase, field };
      flag.avoid = avoidLine(flag);
      flags.push(flag);
    }
  }
  return flags;
}

export function collectStringLeaves(value, trail = [], leaves = []) {
  if (typeof value === "string") {
    if (value.trim()) leaves.push({ field: trail.join(".") || "(root)", text: value });
    return leaves;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringLeaves(item, [...trail, String(index)], leaves));
    return leaves;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SKIP_KEYS.has(key)) continue;
      collectStringLeaves(child, [...trail, key], leaves);
    }
  }
  return leaves;
}

export function mergeAvoid(existing, additions) {
  const list = Array.isArray(existing) ? existing.filter((item) => typeof item === "string" && item.trim()) : [];
  const seen = new Set(list.map((item) => item.trim()));
  for (const entry of additions) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const trimmed = entry.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    list.push(trimmed);
  }
  return list;
}
