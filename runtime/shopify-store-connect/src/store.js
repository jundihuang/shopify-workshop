export const REQUIRED_SCOPES = Object.freeze([
  "write_products",
  "write_themes",
  "write_publications",
]);

export const STOREFRONT_SESSION_HANDLE = "access_url";
export const AUTH_MODE = "cli_cached_admin_token";
export const STORE_TYPE = "preview";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Accept a storefront URL, a myshopify.com hostname, or a bare subdomain and
 * return the canonical *.myshopify.com domain.
 */
export function normalizeShopDomain(value) {
  const input = firstString(value);
  if (!input) return null;

  let host = input;
  if (input.includes("://")) {
    try {
      host = new URL(input).hostname;
    } catch {
      return null;
    }
  } else {
    host = input.split(/[/?#]/, 1)[0];
  }

  host = host.toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(" ")) return null;

  if (!host.includes(".")) host = `${host}.myshopify.com`;
  if (!host.endsWith(".myshopify.com")) return null;

  const subdomain = host.slice(0, -".myshopify.com".length);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(subdomain)) return null;
  return host;
}

function normalizeScopes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((scope) => typeof scope === "string" && scope.trim()).map((scope) => scope.trim()))];
}

function readPasswordProtectionEnabled(store) {
  const candidates = [
    store.password_protection_enabled,
    store.passwordProtection?.enabled,
    store.onlineStore?.passwordProtection?.enabled,
  ];
  return candidates.find((value) => typeof value === "boolean") ?? null;
}

function assertPreviewType(type, source) {
  if (typeof type !== "string" || !type.trim()) return;
  if (type.trim().toLowerCase() !== STORE_TYPE) {
    throw new Error(`${source} reported store type "${type}", but only Preview Stores are allowed`);
  }
}

export function verifyScopes(scopes) {
  const present = new Set(normalizeScopes(scopes));
  const include = REQUIRED_SCOPES.filter((scope) => present.has(scope));
  const missing = REQUIRED_SCOPES.filter((scope) => !present.has(scope));
  return {
    scopes_ok: missing.length === 0,
    scopes_include: include,
    missing_scopes: missing,
  };
}

export function parseCreateStoreResult(payload) {
  const root = asObject(payload) ?? {};
  const store = asObject(root.store) ?? root;

  const domain = normalizeShopDomain(
    firstString(store.subdomain, store.storeDomain, store.domain, store.storefrontUrl, store.storefront_url),
  );
  if (!domain) {
    throw new Error("Shopify create output did not include a valid Preview Store myshopify.com domain");
  }

  assertPreviewType(store.type, "Shopify create output");

  const storeName = firstString(store.name, store.displayName, store.storeName) ?? domain;
  const scopes = normalizeScopes(store.authScopes ?? store.scopes ?? root.authScopes);

  return {
    domain,
    storeName,
    storeType: STORE_TYPE,
    scopes,
    passwordProtectionEnabled: readPasswordProtectionEnabled(store),
  };
}

export function parseStoreInfoResult(payload) {
  const root = asObject(payload) ?? {};
  const store = asObject(root.store) ?? root;

  const domain = normalizeShopDomain(
    firstString(store.subdomain, store.storeDomain, store.domain, store.storefrontUrl, store.storefront_url),
  );
  if (!domain) {
    throw new Error("Shopify store info did not include a valid myshopify.com domain");
  }

  assertPreviewType(store.type, "Shopify store info");

  const accessUrl = firstString(store.accessUrl, store.access_url);
  if (!accessUrl) {
    throw new Error("Shopify store info did not include accessUrl");
  }
  if (!/^https?:\/\//i.test(accessUrl)) {
    throw new Error("Shopify store info returned an unexpected accessUrl format");
  }

  const storeName = firstString(store.displayName, store.name, store.storeName) ?? domain;
  const scopes = normalizeScopes(store.authScopes ?? store.scopes ?? root.authScopes);

  return {
    domain,
    storeName,
    storeType: STORE_TYPE,
    accessUrl,
    scopes,
    passwordProtectionEnabled: readPasswordProtectionEnabled(store),
  };
}

export function buildConnectionArtifact({
  domain,
  storeName,
  scopes,
  passwordProtectionEnabled,
  productCount = 0,
}) {
  const verification = verifyScopes(scopes);
  const artifact = {
    store: domain,
    store_name: storeName,
    store_type: STORE_TYPE,
    auth: AUTH_MODE,
    scopes_ok: verification.scopes_ok,
    scopes_include: verification.scopes_include,
    storefront_session: STOREFRONT_SESSION_HANDLE,
    product_count: Number.isFinite(productCount) ? productCount : 0,
  };

  if (typeof passwordProtectionEnabled === "boolean") {
    // This is an Admin switch echo, not a storefront password or secret.
    artifact.password_protection_enabled = passwordProtectionEnabled;
  }

  return artifact;
}

export function buildVerificationResult(info) {
  const verification = verifyScopes(info.scopes);
  return {
    store: info.domain,
    store_name: info.storeName,
    store_type: STORE_TYPE,
    auth: AUTH_MODE,
    scopes_ok: verification.scopes_ok,
    scopes_include: verification.scopes_include,
    missing_scopes: verification.missing_scopes,
    storefront_session: STOREFRONT_SESSION_HANDLE,
    access_url_available: Boolean(info.accessUrl),
  };
}
