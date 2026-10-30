import path from "node:path";
import { pathExists, readJsonFile, readTextOrEmpty } from "./files.js";
import { readWorkshopFacts } from "./state.js";

const SECRET_KEYS = Object.freeze([
  "password",
  "storefront_password",
  "opening_soon_password",
  "online_store_password",
]);

function accessUrlFrom(connection) {
  const value = connection.accessUrl ?? connection.access_url;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function readGeoConnection(groupDir) {
  const connectionPath = path.join(groupDir, "connection.json");
  if (!(await pathExists(connectionPath))) {
    throw new Error(
      `Preview Store connection not found at ${connectionPath}. Run shopify-store-connect first; workshop GEO never invents a store.`,
    );
  }

  const connection = await readJsonFile(connectionPath);
  if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
    throw new Error("connection.json must be an object");
  }
  for (const key of SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(connection, key) && connection[key]) {
      throw new Error(
        "Refusing a storefront password flow. Workshop GEO does not accept an Opening soon password.",
      );
    }
  }
  if (connection.store_type !== "preview") {
    throw new Error(
      `Refusing to score: connection.store_type is "${connection.store_type ?? "missing"}", but only Preview Stores are allowed.`,
    );
  }

  const store = String(connection.store ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(store)) {
    throw new Error("Refusing to score: connection.json does not contain a valid myshopify.com store domain.");
  }

  const scopes = Array.isArray(connection.scopes_include) ? connection.scopes_include.map(String) : [];
  const canReadProducts = scopes.includes("read_products") || scopes.includes("write_products");
  if (connection.scopes_ok !== true || !canReadProducts) {
    throw new Error(
      "Refusing to score: connection.json must report scopes_ok=true and include read_products or write_products. Re-run shopify-store-connect verify.",
    );
  }

  const stateText = await readTextOrEmpty(path.join(groupDir, "workshop-state.yaml"));
  const facts = readWorkshopFacts(stateText);
  if (facts.storeDomain && facts.storeDomain !== store) {
    throw new Error(
      `workshop-state.yaml store_domain (${facts.storeDomain}) does not match connection.json store (${store}).`,
    );
  }

  const session = connection.storefront_session === "access_url" || connection.storefront_session === "none"
    ? connection.storefront_session
    : facts.storefrontSession;

  return {
    store,
    store_type: "preview",
    auth: connection.auth === "cli_cached_admin_token" ? "cli_cached_admin_token" : "unknown",
    scopes_include: [...scopes],
    storefront_session: session === "access_url" ? "access_url" : "none",
    accessUrlForGuard: accessUrlFrom(connection),
    facts,
    stateText,
  };
}
