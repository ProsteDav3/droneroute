/**
 * Mapbox source/layer ids for the mission's own buildings.
 *
 * `BuildingPolygon` builds these to render, and `MapView` reads them back to
 * work out which building was clicked. Keeping both directions here means a
 * rename can't silently break the click menu: a building id is a uuid and
 * contains dashes itself, so the parse has to strip known affixes rather than
 * split on a separator.
 */

const PREFIX = "building-";

export function buildingSourceId(buildingId: string): string {
  return `${PREFIX}${buildingId}`;
}

/** The clickable fill layers — flat in 2D, extruded in 3D. Only one of the
 * two is visible at a time, and `queryRenderedFeatures` ignores the hidden
 * one, so both can be handed to it. */
export function buildingFillLayerIds(buildingId: string): [string, string] {
  const source = buildingSourceId(buildingId);
  return [`${source}-fill-2d`, `${source}-fill-3d`];
}

export function buildingOutlineLayerId(buildingId: string): string {
  return `${buildingSourceId(buildingId)}-outline`;
}

/** The building id behind a fill layer id, or `null` if the id isn't one of
 * ours (another source's layer, or an outline rather than a fill). */
export function buildingIdFromFillLayerId(layerId: string): string | null {
  if (!layerId.startsWith(PREFIX)) return null;
  const match = /^building-(.+)-fill-(?:2d|3d)$/.exec(layerId);
  return match ? match[1] : null;
}
