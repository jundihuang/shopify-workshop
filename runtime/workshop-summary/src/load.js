import path from "node:path";
import { pathExists, readJsonFile, readTextOrEmpty } from "./files.js";
import {
  AFTER_FILENAME,
  APPROVED_FILENAME,
  BEFORE_FILENAME,
  BRIEF_FILENAME,
  CHANNEL_FILENAME,
  CONNECTION_FILENAME,
  IMPORT_FILENAME,
  PROPOSAL_FILENAME,
  STATE_FILENAME,
  THEME_FILENAME,
} from "./paths.js";
import { assertNoSensitiveKeys } from "./redact.js";
import { readWorkshopFacts } from "./state.js";

const STORE_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const PREVIEW_URL = /^https:\/\/([a-z0-9][a-z0-9-]*\.myshopify\.com)\/\?preview_theme_id=(\d+)$/;
const SECRET_KEYS = Object.freeze([
  "password",
  "storefront_password",
  "opening_soon_password",
  "online_store_password",
]);

export const DIMENSION_KEYS = Object.freeze([
  "product_data_completeness",
  "search_findability",
  "ai_understandability",
  "purchase_trust",
  "technical_visibility",
]);

export class SummaryRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "SummaryRefusal";
  }
}

const SENSITIVE_KEY = /^(?:access[_-]?url|access[_-]?token|admin[_-]?token|api[_-]?token|token|secret|password)$/i;

function guardSecretsFrom(value, found = []) {
  if (!value || typeof value !== "object") return found;
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [key, child] of entries) {
    if (!Array.isArray(value) && SENSITIVE_KEY.test(key) && typeof child === "string" && child.trim().length > 8) {
      found.push(child.trim());
      continue;
    }
    if (child && typeof child === "object") guardSecretsFrom(child, found);
  }
  return found;
}

function asObject(value, filename) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filename} must be a JSON object`);
  }
  return value;
}

export function assertWorkshopScorecard(doc, filename) {
  const value = asObject(doc, filename);
  if (value.skill !== "shopify-geo-eval-workshop") {
    throw new SummaryRefusal(
      `Refusing ${filename}: summary reads the shopify-geo-eval-workshop scorecard only. This is a workshop scorecard, not the full diagnostic.`,
    );
  }
  const dimensions = value.dimensions;
  if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) {
    throw new Error(`${filename} is missing workshop scorecard dimensions`);
  }
  const extras = Object.keys(dimensions).filter((key) => !DIMENSION_KEYS.includes(key));
  if (extras.length > 0) {
    throw new SummaryRefusal(`Refusing ${filename}: dimensions must stay the workshop 5.`);
  }
  for (const key of DIMENSION_KEYS) {
    if (!Number.isFinite(Number(dimensions[key]))) {
      throw new Error(`${filename} is missing workshop dimension ${key}`);
    }
  }
  if (!Number.isFinite(Number(value.geo_score))) {
    throw new Error(`${filename} is missing geo_score`);
  }
  return value;
}

export function safePreviewUrl(store, previewUrl) {
  if (typeof previewUrl !== "string") return null;
  const match = previewUrl.match(PREVIEW_URL);
  if (!match) return null;
  if (store && match[1] !== store) return null;
  return previewUrl;
}

function retargetPreview(previewUrl, store) {
  if (!store) return previewUrl;
  const match = typeof previewUrl === "string" ? previewUrl.match(PREVIEW_URL) : null;
  if (!match) return undefined;
  return `https://${store}/?preview_theme_id=${match[2]}`;
}

function retargetScorecard(card, store, fromFixture) {
  if (!fromFixture || !store) return card;
  const next = { ...card, store };
  const preview = retargetPreview(card.preview_url, store);
  if (preview) next.preview_url = preview;
  else delete next.preview_url;
  return next;
}

function retargetTheme(manifest, store, fromFixture) {
  if (!fromFixture || !store) return manifest;
  const next = { ...manifest, store, store_type: "preview" };
  const id = Number(manifest.theme_id);
  if (Number.isInteger(id) && id > 0) {
    next.preview_url = `https://${store}/?preview_theme_id=${id}`;
  }
  return next;
}

function publicConnection(connection) {
  return {
    store: connection.store,
    store_type: "preview",
    auth: connection.auth === "cli_cached_admin_token" ? "cli_cached_admin_token" : "unknown",
    scopes_ok: connection.scopes_ok === true,
    storefront_session: connection.storefront_session === "access_url" ? "access_url" : "none",
  };
}

function validateConnection(connection, filename) {
  const value = asObject(connection, filename);
  for (const key of SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key]) {
      throw new SummaryRefusal(
        "Refusing a storefront password flow. The workshop summary does not accept an Opening soon password.",
      );
    }
  }
  if (value.store_type !== "preview") {
    throw new SummaryRefusal(
      `Refusing non-preview store: ${filename} store_type is "${value.store_type ?? "missing"}". Preview Store is the only store path.`,
    );
  }
  const store = String(value.store ?? "").trim().toLowerCase();
  if (!STORE_DOMAIN.test(store)) {
    throw new SummaryRefusal(`Refusing ${filename}: store must be a myshopify.com domain.`);
  }
  return {
    ...publicConnection({ ...value, store }),
    guardSecrets: guardSecretsFrom(value),
  };
}

async function readGroupConnection(groupDir) {
  const filePath = path.join(groupDir, CONNECTION_FILENAME);
  if (!(await pathExists(filePath))) return null;
  return validateConnection(await readJsonFile(filePath), CONNECTION_FILENAME);
}

async function readFixtureConnection(fixturesDir) {
  const filePath = path.join(fixturesDir, CONNECTION_FILENAME);
  const connection = validateConnection(await readJsonFile(filePath), CONNECTION_FILENAME);
  if (connection.guardSecrets.length > 0) {
    throw new SummaryRefusal("Refusing fixture connection.json that contains an accessUrl or token.");
  }
  return connection;
}

async function readOptional(groupDir, fixturesDir, filename, { dryRun, accept, retarget, store }) {
  const groupPath = path.join(groupDir, filename);
  let replacedInvalid = null;
  if (await pathExists(groupPath)) {
    try {
      const parsed = await readJsonFile(groupPath);
      try {
        assertNoSensitiveKeys(parsed, filename);
      } catch (error) {
        throw new SummaryRefusal(error.message);
      }
      const accepted = accept ? accept(parsed, filename) : asObject(parsed, filename);
      return {
        value: retarget ? retarget(accepted, store, false) : accepted,
        source: "group",
      };
    } catch (error) {
      if (error instanceof SummaryRefusal) throw error;
      if (!dryRun) {
        return { value: null, source: "invalid", error: error.message };
      }
      replacedInvalid = error.message;
    }
  } else if (!dryRun) {
    return { value: null, source: "missing" };
  }

  const fixturePath = path.join(fixturesDir, filename);
  const parsed = await readJsonFile(fixturePath);
  try {
    assertNoSensitiveKeys(parsed, filename);
  } catch (error) {
    throw new SummaryRefusal(error.message);
  }
  const accepted = accept ? accept(parsed, filename) : asObject(parsed, filename);
  return {
    value: retarget ? retarget(accepted, store, true) : accepted,
    source: "fixture",
    error: replacedInvalid
      ? `${filename} was unreadable (${replacedInvalid}). This dry-run used the fixture copy.`
      : undefined,
  };
}

/**
 * Read the group directory. --dry-run fills a missing or unreadable artifact
 * from fixtures and records that filename. Present, readable group files win.
 */
export async function loadWorkshopBundle({ groupDir, dryRun, fixturesDir }) {
  const stateText = await readTextOrEmpty(path.join(groupDir, STATE_FILENAME));
  const facts = readWorkshopFacts(stateText);
  const fixtureFilled = [];
  const readErrors = [];
  const sources = {};

  let connection = await readGroupConnection(groupDir);
  if (connection) {
    sources[CONNECTION_FILENAME] = "group";
  } else if (dryRun) {
    connection = await readFixtureConnection(fixturesDir);
    sources[CONNECTION_FILENAME] = "fixture";
    fixtureFilled.push(CONNECTION_FILENAME);
  } else {
    sources[CONNECTION_FILENAME] = "missing";
  }

  if (facts.storeType && facts.storeType !== "preview") {
    throw new SummaryRefusal(
      `Refusing non-preview store: workshop-state.yaml store_type is "${facts.storeType}". Preview Store is the only store path.`,
    );
  }

  const store = connection?.store || null;
  if (store && facts.storeDomain && facts.storeDomain !== store) {
    readErrors.push(
      `workshop-state.yaml store_domain (${facts.storeDomain}) does not match connection.json store (${store}).`,
    );
  }

  const specs = [
    [IMPORT_FILENAME, { accept: (value, filename) => asObject(value, filename) }],
    [CHANNEL_FILENAME, { accept: (value, filename) => asObject(value, filename) }],
    [BRIEF_FILENAME, { accept: (value, filename) => asObject(value, filename) }],
    [THEME_FILENAME, { accept: (value, filename) => asObject(value, filename), retarget: retargetTheme }],
    [BEFORE_FILENAME, { accept: assertWorkshopScorecard, retarget: retargetScorecard }],
    [PROPOSAL_FILENAME, { accept: (value, filename) => asObject(value, filename), retarget: retargetScorecard }],
    [APPROVED_FILENAME, { accept: (value, filename) => asObject(value, filename), retarget: retargetScorecard }],
    [AFTER_FILENAME, { accept: assertWorkshopScorecard, retarget: retargetScorecard }],
  ];

  const loaded = {};
  for (const [filename, spec] of specs) {
    const result = await readOptional(groupDir, fixturesDir, filename, {
      dryRun,
      accept: spec.accept,
      retarget: spec.retarget,
      store,
    });
    loaded[filename] = result.value;
    sources[filename] = result.source;
    if (result.source === "fixture") fixtureFilled.push(filename);
    if (result.error) readErrors.push(result.error);
  }

  return {
    dryRun: Boolean(dryRun),
    store,
    connection: connection ? publicConnection(connection) : null,
    guardSecrets: connection?.guardSecrets || [],
    facts,
    stateText,
    importResult: loaded[IMPORT_FILENAME],
    channel: loaded[CHANNEL_FILENAME],
    brief: loaded[BRIEF_FILENAME],
    theme: loaded[THEME_FILENAME],
    before: loaded[BEFORE_FILENAME],
    proposal: loaded[PROPOSAL_FILENAME],
    approved: loaded[APPROVED_FILENAME],
    after: loaded[AFTER_FILENAME],
    sources,
    fixtureFilled,
    readErrors,
  };
}
