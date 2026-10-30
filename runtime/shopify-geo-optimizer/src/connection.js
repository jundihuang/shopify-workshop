import path from "node:path";
import { pathExists, readJsonFile, readTextOrEmpty } from "./files.js";

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

function scalar(block, key) {
  const match = block.match(new RegExp(`^  ${key}:\\s*(.*)$`, "m"));
  if (!match) return null;
  let value = match[1].trim();
  if (value === "" || value === "null" || value === "~") return null;
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function sectionBody(text, name) {
  const source = `${String(text || "").replace(/\s*$/, "")}\n`;
  const match = source.match(new RegExp(`^${name}:\\n([\\s\\S]*?)\\n(?=[^\\s\\n]|$)`, "m"));
  return match ? match[1] : "";
}

export async function readOptimizerConnection(groupDir) {
  const connectionPath = path.join(groupDir, "connection.json");
  if (!(await pathExists(connectionPath))) {
    throw new Error(
      `Preview Store connection not found at ${connectionPath}. Run shopify-store-connect first.`,
    );
  }

  const connection = await readJsonFile(connectionPath);
  if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
    throw new Error("connection.json must be an object");
  }
  for (const key of SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(connection, key) && connection[key]) {
      throw new Error(
        "Refusing a storefront password flow. The workshop optimizer does not accept an Opening soon password.",
      );
    }
  }
  if (connection.store_type !== "preview") {
    throw new Error(
      `Refusing non-preview store: connection.store_type is "${connection.store_type ?? "missing"}". Preview Store is the only store path.`,
    );
  }

  const store = String(connection.store ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(store)) {
    throw new Error("Refusing to optimize: connection.json does not contain a valid myshopify.com store domain.");
  }

  const scopes = Array.isArray(connection.scopes_include) ? connection.scopes_include.map(String) : [];
  if (connection.scopes_ok !== true || !scopes.includes("write_products")) {
    throw new Error(
      "Refusing to optimize: connection.json must report scopes_ok=true and include write_products.",
    );
  }

  const stateText = await readTextOrEmpty(path.join(groupDir, "workshop-state.yaml"));
  const domainMatch = stateText.match(/^store_domain:\s*(.+)$/m);
  let storeDomain = domainMatch ? domainMatch[1].trim() : null;
  if (storeDomain && ((storeDomain.startsWith('"') && storeDomain.endsWith('"')) || (storeDomain.startsWith("'") && storeDomain.endsWith("'")))) {
    storeDomain = storeDomain.slice(1, -1);
  }
  if (storeDomain === "null") storeDomain = null;
  if (storeDomain && storeDomain !== store) {
    throw new Error(
      `workshop-state.yaml store_domain (${storeDomain}) does not match connection.json store (${store}).`,
    );
  }

  return {
    store,
    store_type: "preview",
    auth: connection.auth === "cli_cached_admin_token" ? "cli_cached_admin_token" : "unknown",
    scopes_include: [...scopes],
    storefront_session: connection.storefront_session === "access_url" ? "access_url" : "none",
    accessUrlForGuard: accessUrlFrom(connection),
    channelStatus: scalar(sectionBody(stateText, "products"), "channel_status"),
    stateText,
  };
}
