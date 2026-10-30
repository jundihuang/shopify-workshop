import { readJsonFile } from "./files.js";
import { defaultSchemaPath } from "./paths.js";

let cachedSchema;

export async function loadBrandBriefSchema(schemaPath = defaultSchemaPath()) {
  if (!schemaPath || schemaPath === defaultSchemaPath()) {
    if (!cachedSchema) cachedSchema = await readJsonFile(defaultSchemaPath());
    return cachedSchema;
  }
  return readJsonFile(schemaPath);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function checkType(value, type, field, errors) {
  if (type === "string" && typeof value !== "string") {
    errors.push({ path: field, message: `${field} must be a string` });
    return false;
  }
  if (type === "array" && !Array.isArray(value)) {
    errors.push({ path: field, message: `${field} must be an array` });
    return false;
  }
  if (type === "object" && !isObject(value)) {
    errors.push({ path: field, message: `${field} must be an object` });
    return false;
  }
  return true;
}

/**
 * Validate a brand brief against templates/brand-brief.schema.json.
 * Required strings must be non-empty. Array item types follow the schema.
 * Returns a list of { path, message } errors; an empty list means valid.
 */
export function validateBrandBrief(brief, schema) {
  const errors = [];
  if (!isObject(brief)) {
    return [{ path: "", message: "Brand brief must be an object" }];
  }
  if (!isObject(schema) || !Array.isArray(schema.required) || !isObject(schema.properties)) {
    return [{ path: "", message: "Brand brief schema is missing required or properties" }];
  }

  for (const key of schema.required) {
    if (!Object.prototype.hasOwnProperty.call(brief, key) || brief[key] === null || brief[key] === undefined) {
      errors.push({ path: key, message: `Missing required field ${key}` });
    }
  }

  for (const [key, definition] of Object.entries(schema.properties)) {
    if (brief[key] === undefined) continue;
    const typeOk = checkType(brief[key], definition.type, key, errors);
    if (!typeOk) continue;

    if (definition.type === "string" && schema.required.includes(key) && !brief[key].trim()) {
      errors.push({ path: key, message: `Required field ${key} is empty` });
    }

    if (definition.type === "array") {
      const itemType = definition.items?.type;
      brief[key].forEach((item, index) => {
        if (itemType === "string" && typeof item !== "string") {
          errors.push({ path: `${key}.${index}`, message: `${key}.${index} must be a string` });
        } else if (itemType === "string" && !item.trim()) {
          errors.push({ path: `${key}.${index}`, message: `${key}.${index} is empty` });
        }
      });
    }

    if (definition.type === "object") {
      const child = brief[key];
      for (const requiredKey of definition.required || []) {
        if (typeof child[requiredKey] !== "string" || !child[requiredKey].trim()) {
          errors.push({
            path: `${key}.${requiredKey}`,
            message: `Missing required field ${key}.${requiredKey}`,
          });
        }
      }
      for (const [childKey, childDefinition] of Object.entries(definition.properties || {})) {
        if (child[childKey] === undefined) continue;
        const childOk = checkType(child[childKey], childDefinition.type, `${key}.${childKey}`, errors);
        if (!childOk) continue;
        if (childDefinition.type === "array") {
          const itemType = childDefinition.items?.type;
          child[childKey].forEach((item, index) => {
            if (itemType === "string" && (typeof item !== "string" || !item.trim())) {
              errors.push({
                path: `${key}.${childKey}.${index}`,
                message: `${key}.${childKey}.${index} must be a non-empty string`,
              });
            }
          });
        }
      }
    }
  }

  return errors;
}

export function formatSchemaErrors(errors) {
  return errors.map((error) => error.path || error.message).filter(Boolean).join(", ");
}
