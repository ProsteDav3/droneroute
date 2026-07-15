/**
 * Server-side validation for mission payloads.
 *
 * Client-side checks are UX only — every payload that gets persisted or fed to
 * the KMZ generator is validated here too. The goal is to reject malformed,
 * oversized or out-of-range data before it reaches the database or downstream
 * processing (defends against DoS via huge arrays, NaN/Infinity coordinates and
 * type-confusion). Each validator returns an error string, or `null` when valid.
 */

const MAX_NAME_LEN = 200;
const MAX_WAYPOINTS = 5000;
const MAX_POIS = 2000;
const MAX_OBSTACLES = 1000;
const MAX_VERTICES_PER_OBSTACLE = 5000;
const MAX_BUILDINGS = 1000;
const MAX_VERTICES_PER_BUILDING = 5000;
const MAX_TEMPLATE_GROUPS = 500;
const MAX_TEMPLATE_GROUP_PARAMS_JSON_LEN = 20000;
const VALID_TEMPLATE_GROUP_TYPES = [
  "orbit",
  "grid",
  "facade",
  "pencil",
  "solar",
  "corridor",
  "turbine",
];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isLatitude(v: unknown): boolean {
  return isFiniteNumber(v) && v >= -90 && v <= 90;
}

function isLongitude(v: unknown): boolean {
  return isFiniteNumber(v) && v >= -180 && v <= 180;
}

// Generous bound covering any real-world height reference (AGL, above
// start point, or EGM96/MSL) from below the Dead Sea to above Everest —
// just enough to reject typos/garbage, not to constrain legitimate flights.
const MIN_HEIGHT_M = -500;
const MAX_HEIGHT_M = 9000;

function isHeight(v: unknown): boolean {
  return isFiniteNumber(v) && v >= MIN_HEIGHT_M && v <= MAX_HEIGHT_M;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidName(v: unknown): boolean {
  return (
    typeof v === "string" && v.trim().length >= 1 && v.length <= MAX_NAME_LEN
  );
}

function isOptionalName(v: unknown): boolean {
  return v === undefined || (typeof v === "string" && v.length <= MAX_NAME_LEN);
}

function validateWaypoints(value: unknown): string | null {
  if (!Array.isArray(value)) return "waypoints musí být pole";
  if (value.length > MAX_WAYPOINTS) return "příliš mnoho bodů trasy";
  for (const wp of value) {
    if (!isPlainObject(wp)) return "neplatný bod trasy";
    if (!isLatitude(wp.latitude) || !isLongitude(wp.longitude)) {
      return "souřadnice bodu trasy mimo rozsah";
    }
    if (!isHeight(wp.height)) return "neplatná výška bodu trasy";
    if (!isOptionalName(wp.name)) return "neplatný název bodu trasy";
  }
  return null;
}

function validatePois(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "pois musí být pole";
  if (value.length > MAX_POIS) return "příliš mnoho bodů zájmu";
  for (const poi of value) {
    if (!isPlainObject(poi)) return "neplatný bod zájmu";
    if (!isLatitude(poi.latitude) || !isLongitude(poi.longitude)) {
      return "souřadnice POI mimo rozsah";
    }
    if (!isHeight(poi.height)) return "neplatná výška POI";
    if (!isOptionalName(poi.name)) return "neplatný název POI";
  }
  return null;
}

function validateObstacles(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "obstacles musí být pole";
  if (value.length > MAX_OBSTACLES) return "příliš mnoho překážek";
  for (const obstacle of value) {
    if (!isPlainObject(obstacle)) return "neplatná překážka";
    if (!Array.isArray(obstacle.vertices)) return "neplatné vrcholy překážky";
    if (obstacle.vertices.length > MAX_VERTICES_PER_OBSTACLE) {
      return "příliš mnoho vrcholů překážky";
    }
    for (const vertex of obstacle.vertices) {
      if (
        !Array.isArray(vertex) ||
        vertex.length !== 2 ||
        !isLatitude(vertex[0]) ||
        !isLongitude(vertex[1])
      ) {
        return "vrchol překážky mimo rozsah";
      }
    }
    if (!isOptionalName(obstacle.name)) return "neplatný název překážky";
  }
  return null;
}

function validateBuildings(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "buildings musí být pole";
  if (value.length > MAX_BUILDINGS) return "příliš mnoho budov";
  for (const building of value) {
    if (!isPlainObject(building)) return "neplatná budova";
    if (!Array.isArray(building.vertices)) return "neplatné vrcholy budovy";
    if (building.vertices.length > MAX_VERTICES_PER_BUILDING) {
      return "příliš mnoho vrcholů budovy";
    }
    for (const vertex of building.vertices) {
      if (
        !Array.isArray(vertex) ||
        vertex.length !== 2 ||
        !isLatitude(vertex[0]) ||
        !isLongitude(vertex[1])
      ) {
        return "vrchol budovy mimo rozsah";
      }
    }
    if (!isFiniteNumber(building.height) || building.height < 0) {
      return "neplatná výška budovy";
    }
    if (!isOptionalName(building.name)) return "neplatný název budovy";
  }
  return null;
}

/**
 * `templateGroups` is a map keyed by group id (not an array like obstacles/
 * buildings) — `{type, params}` per applied template, so an already-applied
 * template can be reopened and edited as a group. `params` is opaque to the
 * backend (its shape depends on `type`); validated only for outer shape and
 * size, the same rigor already applied to `MissionConfig`/`TemplatePreset`.
 */
function validateTemplateGroups(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isPlainObject(value)) return "templateGroups musí být objekt";
  const groups = Object.values(value);
  if (groups.length > MAX_TEMPLATE_GROUPS) return "příliš mnoho skupin šablon";
  for (const group of groups) {
    if (!isPlainObject(group)) return "neplatná skupina šablony";
    if (
      typeof group.type !== "string" ||
      !VALID_TEMPLATE_GROUP_TYPES.includes(group.type)
    ) {
      return "neplatný typ skupiny šablony";
    }
    if (!isPlainObject(group.params))
      return "neplatné parametry skupiny šablony";
    if (
      JSON.stringify(group.params).length > MAX_TEMPLATE_GROUP_PARAMS_JSON_LEN
    ) {
      return "parametry skupiny šablony jsou příliš velké";
    }
  }
  return null;
}

export interface MissionPayload {
  name?: unknown;
  client?: unknown;
  config?: unknown;
  waypoints?: unknown;
  pois?: unknown;
  obstacles?: unknown;
  buildings?: unknown;
  templateGroups?: unknown;
}

/** Validate a full mission-create payload. Returns an error message or null. */
export function validateMissionCreate(body: MissionPayload): string | null {
  if (!isValidName(body.name)) return "neplatný název mise";
  if (!isOptionalName(body.client)) return "neplatný klient/zakázka";
  if (!isPlainObject(body.config)) return "neplatná konfigurace mise";
  return (
    validateWaypoints(body.waypoints) ??
    validatePois(body.pois) ??
    validateObstacles(body.obstacles) ??
    validateBuildings(body.buildings) ??
    validateTemplateGroups(body.templateGroups)
  );
}

/**
 * Validate a partial mission-update payload — only the fields that are present
 * are checked.
 */
export function validateMissionUpdate(body: MissionPayload): string | null {
  if (body.name !== undefined && !isValidName(body.name)) {
    return "neplatný název mise";
  }
  if (body.client !== undefined && !isOptionalName(body.client)) {
    return "neplatný klient/zakázka";
  }
  if (body.config !== undefined && !isPlainObject(body.config)) {
    return "neplatná konfigurace mise";
  }
  if (body.waypoints !== undefined) {
    const error = validateWaypoints(body.waypoints);
    if (error) return error;
  }
  return (
    validatePois(body.pois) ??
    validateObstacles(body.obstacles) ??
    validateBuildings(body.buildings) ??
    validateTemplateGroups(body.templateGroups)
  );
}

/**
 * Validate the geometry of a parsed/submitted mission used for KMZ generation
 * and import — config shape is left to the caller, this focuses on the arrays.
 */
export function validateMissionGeometry(body: MissionPayload): string | null {
  return (
    validateWaypoints(body.waypoints) ??
    validatePois(body.pois) ??
    validateObstacles(body.obstacles) ??
    validateBuildings(body.buildings) ??
    validateTemplateGroups(body.templateGroups)
  );
}
