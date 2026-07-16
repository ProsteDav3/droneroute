/**
 * ŘLP ČR airspace provider – Czech Republic.
 *
 * Řízení letového provozu (Air Navigation Services of the Czech Republic)
 * publishes UAS geographic zone data at https://aim.rlp.cz/?p=uas-gz as
 * plain GeoJSON downloads under a dated "actual" folder (e.g.
 * /data/uas/2026_07_09/actual/...). Unlike ENAIRE's queryable ArcGIS REST
 * API, these are static whole-file downloads with no bbox filtering, so —
 * same strategy as the NATS provider — we discover the current file's URL
 * from the index page, download and cache it, and filter to the requested
 * viewport ourselves.
 *
 * We use GRID_CTR ("restricted areas in controlled airspace"): a grid of
 * cells, each carrying a vertical altitude limit (e.g. "GND - 120 m AGL")
 * above which flying inside that cell requires coordination — the same
 * "restricted, not outright prohibited" category NATS uses for zones
 * around aerodromes. Individual named zones (LKR*.json) are skipped: some
 * of those files are tens of megabytes for a single zone identifier
 * (e.g. railway-corridor restrictions with thousands of polygons), too
 * large to reasonably fetch and cache for this purpose.
 */

import type { AirspaceProvider, AirspaceZone, BBox } from "./types.js";
import { logger } from "../../lib/logger.js";

const INDEX_URL = "https://aim.rlp.cz/?lang=en&p=uas-gz";
const AIM_ORIGIN = "https://aim.rlp.cz";

/** Rough bounding box around the Czech Republic. */
const CZ_BOUNDS: BBox = {
  south: 48.5,
  west: 12.0,
  north: 51.1,
  east: 18.9,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface Cache {
  zones: AirspaceZone[];
  fetchedAt: number;
}

let cache: Cache | null = null;
let fetchInProgress: Promise<AirspaceZone[]> | null = null;

function boundsOverlap(a: BBox, b: BBox): boolean {
  return (
    a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
  );
}

function zoneBBox(coords: number[][]): BBox {
  let south = 90,
    north = -90,
    west = 180,
    east = -180;
  for (const [lng, lat] of coords) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, west, north, east };
}

function zoneIntersects(zone: AirspaceZone, bounds: BBox): boolean {
  const geom = zone.geometry as { type: string; coordinates: unknown };
  if (geom.type === "Polygon") {
    const ring = (geom.coordinates as number[][][])[0];
    return boundsOverlap(zoneBBox(ring), bounds);
  }
  if (geom.type === "MultiPolygon") {
    for (const polygon of geom.coordinates as number[][][][]) {
      if (boundsOverlap(zoneBBox(polygon[0]), bounds)) return true;
    }
  }
  return false;
}

/** Parse "GND - 120 m AGL" (or similar) into a numeric upper limit in metres. */
export function parseVerticalLimitUpper(
  verticalLimit: string | undefined,
): number | undefined {
  if (!verticalLimit) return undefined;
  const match = verticalLimit.match(/(\d+(?:\.\d+)?)\s*m\s*AGL/i);
  return match ? parseFloat(match[1]) : undefined;
}

/**
 * Discover the current GRID_CTR.json download URL from the ŘLP index page —
 * the dated "actual" folder changes as new data cycles are published.
 */
async function discoverDataUrl(): Promise<string> {
  const res = await fetch(INDEX_URL);
  if (!res.ok) {
    throw new Error(`RLP: failed to fetch index page – ${res.status}`);
  }
  const html = await res.text();

  const match = html.match(/href="(\/data\/uas\/[^"]*GRID_CTR\.json)"/);
  if (!match) {
    throw new Error("RLP: no GRID_CTR.json link found on index page");
  }
  return `${AIM_ORIGIN}${match[1]}`;
}

interface RlpFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: {
    ident?: string;
    vertical_limit?: string;
    effective_date?: string;
    publication?: string;
    data_source?: string;
  };
}

/**
 * Guards against malformed/unexpected upstream geometry (e.g. GeoJSON's
 * legal `"geometry": null`, an unsupported geometry type, or empty/missing
 * coordinate rings) ever entering the cache — `zoneIntersects` (used on
 * every subsequent `fetchZones` call against the cached data, not just at
 * download time) throws on exactly these shapes, and since it runs inside
 * an `Array.prototype.filter`, a single bad zone would otherwise fail
 * every request for up to the full cache TTL.
 */
function hasValidGeometry(geometry: unknown): geometry is {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
} {
  if (!geometry || typeof geometry !== "object") return false;
  const geom = geometry as { type?: unknown; coordinates?: unknown };
  if (geom.type === "Polygon") {
    const coords = geom.coordinates as unknown;
    return (
      Array.isArray(coords) &&
      coords.length > 0 &&
      Array.isArray(coords[0]) &&
      coords[0].length >= 3
    );
  }
  if (geom.type === "MultiPolygon") {
    const coords = geom.coordinates as unknown;
    return (
      Array.isArray(coords) &&
      coords.length > 0 &&
      coords.every(
        (poly: unknown) =>
          Array.isArray(poly) && Array.isArray(poly[0]) && poly[0].length >= 3,
      )
    );
  }
  return false;
}

async function downloadAndParse(): Promise<AirspaceZone[]> {
  const dataUrl = await discoverDataUrl();
  logger.info(`RLP: downloading ${dataUrl}`);

  const res = await fetch(dataUrl);
  if (!res.ok) {
    throw new Error(`RLP: download failed – ${res.status}`);
  }

  const doc = (await res.json()) as { features?: RlpFeature[] };
  const rawFeatures = doc.features ?? [];

  const zones: AirspaceZone[] = [];
  let skipped = 0;
  rawFeatures.forEach((f, i) => {
    if (!hasValidGeometry(f.geometry)) {
      skipped++;
      return;
    }
    const upper = parseVerticalLimitUpper(f.properties.vertical_limit);
    zones.push({
      id: `rlp-${f.properties.ident ?? i}`,
      name: f.properties.vertical_limit
        ? `Řízený vzdušný prostor (${f.properties.vertical_limit})`
        : "Řízený vzdušný prostor",
      severity: "restricted",
      geometry: f.geometry,
      altitudeLower: 0,
      altitudeUpper: upper,
      description: f.properties.data_source,
      category: "controlled-airspace",
      source: "rlp",
    });
  });

  logger.info(
    `RLP: parsed ${zones.length} grid cells${skipped > 0 ? ` (skipped ${skipped} with invalid geometry)` : ""}`,
  );

  return zones;
}

async function getCachedZones(): Promise<AirspaceZone[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.zones;
  }
  if (fetchInProgress) {
    return fetchInProgress;
  }

  fetchInProgress = downloadAndParse()
    .then((zones) => {
      cache = { zones, fetchedAt: Date.now() };
      fetchInProgress = null;
      return zones;
    })
    .catch((err) => {
      fetchInProgress = null;
      logger.error({ err }, "RLP: failed to fetch/parse dataset");
      return [];
    });

  return fetchInProgress;
}

export const rlpProvider: AirspaceProvider = {
  id: "rlp",
  name: "ŘLP ČR (Czech Republic)",

  async fetchZones(bounds: BBox): Promise<AirspaceZone[]> {
    if (!boundsOverlap(bounds, CZ_BOUNDS)) {
      return [];
    }

    const allZones = await getCachedZones();
    return allZones.filter((z) => zoneIntersects(z, bounds));
  },
};
