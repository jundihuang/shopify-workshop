import path from "node:path";
import { pathExists, readJsonFile } from "./files.js";

export const REQUIRED_SCOPES = Object.freeze(["write_products", "write_publications"]);

export async function readPublishConnection(groupDir) {
  const connectionPath = path.join(groupDir, "connection.json");
  if (!(await pathExists(connectionPath))) {
    throw new Error(
      `Preview Store connection not found at ${connectionPath}. Run shopify-store-connect first; publish-products-for-geo never invents a store.`,
    );
  }

  const connection = await readJsonFile(connectionPath);
  if (connection.store_type !== "preview") {
    throw new Error(
      `Refusing to publish: connection.store_type is "${connection.store_type ?? "missing"}", but only Preview Stores are allowed.`,
    );
  }

  const store = String(connection.store ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(store)) {
    throw new Error("Refusing to publish: connection.json does not contain a valid myshopify.com store domain.");
  }

  const scopes = Array.isArray(connection.scopes_include) ? connection.scopes_include : [];
  const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
  if (connection.scopes_ok !== true || missing.length > 0) {
    throw new Error(
      `Refusing to publish: connection.json must report scopes_ok=true and include ${REQUIRED_SCOPES.join(", ")}. ` +
        `Missing: ${missing.length > 0 ? missing.join(", ") : "none"}. Re-run shopify-store-connect verify.`,
    );
  }

  return {
    store,
    store_type: "preview",
    auth: connection.auth === "cli_cached_admin_token" ? "cli_cached_admin_token" : "unknown",
    scopes_include: [...scopes],
  };
}
