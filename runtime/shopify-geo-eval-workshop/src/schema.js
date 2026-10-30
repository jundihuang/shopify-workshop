import { readJsonFile } from "./files.js";
import { defaultSchemaPath } from "./paths.js";
import { DIMENSION_KEYS } from "./score.js";

let cachedSchema;

export async function loadGeoScoreSchema(schemaPath = defaultSchemaPath()) {
  if (!schemaPath || schemaPath === defaultSchemaPath()) {
    if (!cachedSchema) cachedSchema = await readJsonFile(defaultSchemaPath());
    return cachedSchema;
  }
  return readJsonFile(schemaPath);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate a workshop scorecard against templates/geo-score.schema.json.
 * Also requires skill to be the workshop const from that schema.
 */
export function validateGeoScore(scorecard, schema) {
  const errors = [];
  if (!isObject(scorecard)) return [{ path: "", message: "Scorecard must be an object" }];
  if (!isObject(schema) || !Array.isArray(schema.required) || !isObject(schema.properties)) {
    return [{ path: "", message: "GEO score schema is missing required or properties" }];
  }

  for (const key of schema.required) {
    if (scorecard[key] === undefined || scorecard[key] === null) {
      errors.push({ path: key, message: `Missing required field ${key}` });
    }
  }

  if (typeof scorecard.store !== "string" || !scorecard.store.trim()) {
    errors.push({ path: "store", message: "store must be a non-empty string" });
  }
  if (typeof scorecard.geo_score !== "number" || scorecard.geo_score < 0 || scorecard.geo_score > 100) {
    errors.push({ path: "geo_score", message: "geo_score must be a number from 0 to 100" });
  }
  const grades = schema.properties.grade?.enum || [];
  if (!grades.includes(scorecard.grade)) {
    errors.push({ path: "grade", message: "grade must be one of A+, A, B, C, D" });
  }
  const modes = schema.properties.evidence_mode?.enum || [];
  if (!modes.includes(scorecard.evidence_mode)) {
    errors.push({ path: "evidence_mode", message: "evidence_mode is not a workshop evidence mode" });
  }

  if (!isObject(scorecard.dimensions)) {
    errors.push({ path: "dimensions", message: "dimensions must be an object" });
  } else {
    for (const key of schema.properties.dimensions?.required || DIMENSION_KEYS) {
      if (typeof scorecard.dimensions[key] !== "number") {
        errors.push({ path: `dimensions.${key}`, message: `Missing dimension ${key}` });
      }
    }
  }

  if (scorecard.restrictions !== undefined) {
    if (!Array.isArray(scorecard.restrictions) || scorecard.restrictions.some((item) => typeof item !== "string")) {
      errors.push({ path: "restrictions", message: "restrictions must be an array of strings" });
    }
  }

  if (scorecard.preview_url !== undefined && typeof scorecard.preview_url !== "string") {
    errors.push({ path: "preview_url", message: "preview_url must be a string" });
  }

  if (scorecard.top_issues !== undefined) {
    if (!Array.isArray(scorecard.top_issues)) {
      errors.push({ path: "top_issues", message: "top_issues must be an array" });
    } else {
      scorecard.top_issues.forEach((item, index) => {
        if (!isObject(item) || typeof item.issue !== "string" || typeof item.impact !== "string") {
          errors.push({ path: `top_issues.${index}`, message: "top issue requires issue and impact" });
          return;
        }
        const priorities = schema.properties.top_issues?.items?.properties?.priority?.enum || ["P0", "P1", "P2"];
        if (!priorities.includes(item.priority)) {
          errors.push({ path: `top_issues.${index}.priority`, message: "priority must be P0, P1, or P2" });
        }
      });
    }
  }

  if (scorecard.products !== undefined) {
    if (!Array.isArray(scorecard.products)) {
      errors.push({ path: "products", message: "products must be an array" });
    } else if (scorecard.products.length > 10) {
      errors.push({ path: "products", message: "products sample must be 10 or fewer" });
    } else {
      scorecard.products.forEach((item, index) => {
        if (!isObject(item) || typeof item.handle !== "string" || !item.handle.trim() || typeof item.score !== "number") {
          errors.push({ path: `products.${index}`, message: "product requires handle and score" });
        }
        if (item.priority !== undefined) {
          const priorities = schema.properties.products?.items?.properties?.priority?.enum || ["P0", "P1", "P2"];
          if (!priorities.includes(item.priority)) {
            errors.push({ path: `products.${index}.priority`, message: "product priority must be P0, P1, or P2" });
          }
        }
      });
    }
  }

  const skillConst = schema.properties.skill?.const;
  if (scorecard.skill !== skillConst) {
    errors.push({ path: "skill", message: `skill must be ${skillConst}` });
  }
  return errors;
}
