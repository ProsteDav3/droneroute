/**
 * Server-side validation for template preset payloads. `params` is treated
 * as an opaque JSON blob (its exact shape depends on `type` and is only
 * meaningful to the frontend's template generators) — validated here only
 * for outer shape and size, the same level of rigor already applied to
 * `MissionConfig` in missionValidation.ts.
 */

const MAX_NAME_LEN = 100;
const MAX_PARAMS_JSON_LEN = 20000;
const VALID_TYPES = ["orbit", "grid", "facade", "pencil", "solar", "corridor"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidName(v: unknown): boolean {
  return (
    typeof v === "string" && v.trim().length >= 1 && v.length <= MAX_NAME_LEN
  );
}

function isValidType(v: unknown): boolean {
  return typeof v === "string" && VALID_TYPES.includes(v);
}

function isValidParams(v: unknown): boolean {
  return isPlainObject(v) && JSON.stringify(v).length <= MAX_PARAMS_JSON_LEN;
}

export interface TemplatePresetPayload {
  name?: unknown;
  type?: unknown;
  params?: unknown;
}

/** Validate a full preset-create payload. Returns an error message or null. */
export function validateTemplatePresetCreate(
  body: TemplatePresetPayload,
): string | null {
  if (!isValidName(body.name)) return "neplatný název šablony";
  if (!isValidType(body.type)) return "neplatný typ šablony";
  if (!isValidParams(body.params)) return "neplatné parametry šablony";
  return null;
}

/**
 * Validate a partial preset-update payload — only the fields that are
 * present are checked. `type` cannot be changed after creation.
 */
export function validateTemplatePresetUpdate(
  body: TemplatePresetPayload,
): string | null {
  if (body.name !== undefined && !isValidName(body.name)) {
    return "neplatný název šablony";
  }
  if (body.params !== undefined && !isValidParams(body.params)) {
    return "neplatné parametry šablony";
  }
  return null;
}
