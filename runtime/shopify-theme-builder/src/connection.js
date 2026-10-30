import path from "node:path";
import { pathExists, readJsonFile, readTextOrEmpty } from "./files.js";

export const REQUIRED_SCOPES = Object.freeze(["write_themes"]);

function accessUrlFrom(connection) {
  const value = connection.accessUrl ?? connection.access_url;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function readThemeConnection(groupDir) {
  const connectionPath = path.join(groupDir, "connection.json");
  if (!(await pathExists(connectionPath))) {
    throw new Error(
      `Preview Store connection not found at ${connectionPath}. Run shopify-store-connect first; shopify-theme-builder never invents a store.`,
    );
  }

  const connection = await readJsonFile(connectionPath);
  if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
    throw new Error("connection.json must be an object");
  }
  if (connection.store_type !== "preview") {
    throw new Error(
      `Refusing to push a theme: connection.store_type is "${connection.store_type ?? "missing"}", but only Preview Stores are allowed.`,
    );
  }

  const store = String(connection.store ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(store)) {
    throw new Error("Refusing to push a theme: connection.json does not contain a valid myshopify.com store domain.");
  }

  const scopes = Array.isArray(connection.scopes_include) ? connection.scopes_include : [];
  const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
  if (connection.scopes_ok !== true || missing.length > 0) {
    throw new Error(
      `Refusing to push a theme: connection.json must report scopes_ok=true and include ${REQUIRED_SCOPES.join(", ")}. ` +
        `Missing: ${missing.length > 0 ? missing.join(", ") : "none"}. Re-run shopify-store-connect verify.`,
    );
  }

  const stateText = await readTextOrEmpty(path.join(groupDir, "workshop-state.yaml"));
  const domainMatch = stateText.match(/^store_domain:\s*"?([^"\n#]+)"?\s*$/m);
  if (domainMatch) {
    const domain = domainMatch[1].trim();
    if (domain && domain !== "null" && domain !== store) {
      throw new Error(
        `workshop-state.yaml store_domain (${domain}) does not match connection.json store (${store}).`,
      );
    }
  }

  return {
    store,
    store_type: "preview",
    auth: connection.auth === "cli_cached_admin_token" ? "cli_cached_admin_token" : "unknown",
    scopes_include: [...scopes],
    accessUrlForGuard: accessUrlFrom(connection),
  };
}
