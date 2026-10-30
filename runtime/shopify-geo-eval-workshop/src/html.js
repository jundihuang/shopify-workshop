/**
 * Optional storefront HTML notes. The session URL stays in local variables
 * and is never returned or written.
 */

function inspectHtml(body) {
  const html = String(body || "");
  const openingSoon = /opening soon/i.test(html);
  let schemaPresent = false;
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = pattern.exec(html);
  while (match) {
    if (/"@type"\s*:\s*"Product"/i.test(match[1])) {
      schemaPresent = true;
      break;
    }
    match = pattern.exec(html);
  }
  return {
    checked: true,
    schema_present: schemaPresent && !openingSoon,
    opening_soon: openingSoon,
  };
}

function productPageUrl(accessUrl, handle, previewThemeId) {
  const session = new URL(accessUrl);
  if (session.protocol !== "https:") {
    throw new Error("Refusing a non-HTTPS storefront session");
  }
  const page = new URL(`/products/${encodeURIComponent(handle)}`, session.origin);
  for (const [key, value] of session.searchParams) {
    if (/password/i.test(key)) continue;
    page.searchParams.append(key, value);
  }
  if (previewThemeId && /^\d+$/.test(String(previewThemeId))) {
    page.searchParams.set("preview_theme_id", String(previewThemeId));
  }
  return page.toString();
}

async function fetchText(url, { fetchImpl, timeoutMs, sleep, attempts }) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          accept: "text/html",
          "user-agent": "ShopWrightWorkshopGeo/0.1",
        },
      });
      lastStatus = response.status;
      if (response.status === 429 && attempt < attempts) {
        await sleep(200 * attempt);
        continue;
      }
      const body = response.ok ? await response.text() : "";
      return {
        ok: response.ok,
        status: response.status,
        body,
        rateLimited: response.status === 429,
      };
    } catch {
      return { ok: false, status: 0, body: "", rateLimited: false };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: lastStatus, body: "", rateLimited: lastStatus === 429 };
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Try product HTML through an ephemeral session URL supplied by loadAccessUrl.
 * The returned notes contain only schema/opening-soon flags.
 */
export async function collectHtmlEvidence({
  handles,
  previewThemeId = null,
  loadAccessUrl,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  timeoutMs = 8000,
  attempts = 3,
}) {
  let accessUrl = null;
  try {
    accessUrl = await loadAccessUrl();
  } catch {
    return { byHandle: {}, restrictions: ["storefront_session_missing"] };
  }
  if (typeof accessUrl !== "string" || !accessUrl.trim()) {
    return { byHandle: {}, restrictions: ["storefront_session_missing"] };
  }

  const byHandle = {};
  let rateLimited = false;
  let sawOpeningSoon = false;
  let sawFailure = false;
  for (const handle of handles) {
    let pageUrl;
    try {
      pageUrl = productPageUrl(accessUrl, handle, previewThemeId);
    } catch {
      return { byHandle: {}, restrictions: ["html_evidence_unavailable"] };
    }
    const page = await fetchText(pageUrl, { fetchImpl, timeoutMs, sleep, attempts });
    if (page.rateLimited) {
      rateLimited = true;
      break;
    }
    if (!page.ok) {
      sawFailure = true;
      continue;
    }
    const note = inspectHtml(page.body);
    if (note.opening_soon) {
      sawOpeningSoon = true;
      continue;
    }
    byHandle[handle] = note;
  }

  const restrictions = [];
  if (Object.keys(byHandle).length === 0) {
    if (rateLimited) restrictions.push("access_url_rate_limited");
    else if (sawOpeningSoon) restrictions.push("unauthenticated_storefront_restricted");
    else if (sawFailure) restrictions.push("html_evidence_unavailable");
    else restrictions.push("html_evidence_unavailable");
  }
  return { byHandle, restrictions };
}

export function previewThemeIdFrom(previewUrl) {
  if (typeof previewUrl !== "string") return null;
  const match = previewUrl.match(/[?&]preview_theme_id=(\d+)\b/);
  return match ? match[1] : null;
}
