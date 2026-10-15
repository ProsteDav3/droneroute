import type { ActionParams } from "@droneroute/shared";

const WPML_PREFIX = "wpml:";

/** Written to WPML as 0/1, held in SkyRoute as true/false. */
const BOOLEAN_PARAMS = new Set([
  "isPointFocus",
  "isInfiniteFocus",
  "gimbalYawRotateEnable",
]);

/** Free text or enum values — a suffix like "2026" must not turn into a number. */
const TEXT_PARAMS = new Set([
  "fileSuffix",
  "payloadLensIndex",
  "gimbalRotateMode",
  "aircraftPathMode",
]);

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toValue(key: string, value: unknown): unknown {
  if (BOOLEAN_PARAMS.has(key)) return toBoolean(value);
  if (TEXT_PARAMS.has(key)) return value == null ? "" : String(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

/**
 * Turns an action's parameters into the shape SkyRoute works with: plain
 * field names (`gimbalPitchRotateAngle`, not `wpml:gimbalPitchRotateAngle`)
 * and real booleans/numbers.
 *
 * The KMZ importer used to store a parsed `<wpml:actionActuatorFuncParam>`
 * as-is, prefixed keys and all. Nothing downstream reads those names, so the
 * export silently fell back to its defaults for every one of them — an
 * imported orbit came back out with the gimbal level (0° instead of -17°),
 * a 5 s hover instead of 3 s, and area focus with no area to focus on.
 * Field-observed on a Matrice 4T over the Congress Centre: that photo
 * mission, made by importing the video orbit and switching it to photo,
 * stopped facing the POI for the whole flight, while the same orbit created
 * directly as photo tracked it.
 *
 * Also applied at export, because missions imported before this fix are
 * saved with the prefixed keys. Where both spellings exist the plain one
 * wins — it is the one the editor has been changing.
 */
export function normalizeActionParams(params: unknown): ActionParams {
  if (params == null || typeof params !== "object") {
    return {} as ActionParams;
  }
  const entries = Object.entries(params as Record<string, unknown>);
  const result: Record<string, unknown> = {};
  for (const [rawKey, value] of entries) {
    if (!rawKey.startsWith(WPML_PREFIX)) continue;
    const key = rawKey.slice(WPML_PREFIX.length);
    result[key] = toValue(key, value);
  }
  for (const [key, value] of entries) {
    if (key.startsWith(WPML_PREFIX)) continue;
    result[key] = value;
  }
  return result as unknown as ActionParams;
}
