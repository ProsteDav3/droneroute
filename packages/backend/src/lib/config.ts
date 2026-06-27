import { DEFAULT_MAP_VIEW, type MapViewState } from "@droneroute/shared";

function inRange(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * Resolve the default map view (center + zoom) shown when the app first loads.
 *
 * Self-hosted instances can override it via the DEFAULT_MAP_VIEW environment
 * variable, formatted as "lat,lng" or "lat,lng,zoom" (e.g. "51.5072,-0.1276,12").
 * Zoom is optional and defaults to the built-in zoom. The whole value falls back
 * to the built-in default when unset or any part is missing, non-numeric, or out
 * of range.
 */
export function resolveDefaultMapView(
  env: NodeJS.ProcessEnv = process.env,
): MapViewState {
  const raw = env.DEFAULT_MAP_VIEW;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAP_VIEW;

  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p === "")) {
    return DEFAULT_MAP_VIEW;
  }

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  const zoom = parts.length === 3 ? Number(parts[2]) : DEFAULT_MAP_VIEW.zoom;

  if (
    !inRange(latitude, -90, 90) ||
    !inRange(longitude, -180, 180) ||
    !inRange(zoom, 0, 22)
  ) {
    return DEFAULT_MAP_VIEW;
  }

  return { latitude, longitude, zoom };
}
