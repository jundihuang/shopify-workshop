import path from "node:path";
import { pathExists, readJsonFile } from "./files.js";

export async function readPreviewConnection(groupDir) {
  const connectionPath = path.join(groupDir, "connection.json");
  if (!(await pathExists(connectionPath))) {
    throw new Error(
      `Preview Store connection not found at ${connectionPath}. Run shopify-store-connect first; product-excel-import never invents a store.`,
    );
  }
  const connection = await readJsonFile(connectionPath);
  if (connection.store_type !== "preview") {
    throw new Error(
      `Refusing to import: connection.store_type is "${connection.store_type ?? "missing"}", but only Preview Stores are allowed.`,
    );
  }
  const store = String(connection.store ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(store)) {
    throw new Error("Refusing to import: connection.json does not contain a valid myshopify.com store domain.");
  }
  const scopes = Array.isArray(connection.scopes_include) ? connection.scopes_include : [];
  if (connection.scopes_ok !== true || !scopes.includes("write_products")) {
    throw new Error(
      "Refusing to import: connection.json must report scopes_ok=true and include write_products. Re-run shopify-store-connect verify.",
    );
  }
  return {
    store,
    store_type: "preview",
    auth: connection.auth === "cli_cached_admin_token" ? "cli_cached_admin_token" : "unknown",
    scopes_include: [...scopes],
  };
}
