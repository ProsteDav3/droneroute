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
 * This is the same official dataset AisView and DronView (the two
 * community/pilot-facing viewers for Czech UAS geo-zones) are built on top
 * of — confirmed by inspecting aim.rlp.cz's "?p=uas-gz" index page, which
 * only offers these files (there is no separate/richer feed those tools
 * pull from instead).
 *
 * We fetch two of the "GRID_*" datasets, both a grid of cells each
 * carrying a vertical altitude limit (e.g. "GND - 120 m AGL") above which
 * flying inside that cell requires coordination — the same
 * "restricted, not outright prohibited" category NATS uses for zones
 * around aerodromes:
 *   - GRID_CTR — restricted areas in controlled airspace.
 *   - GRID_ATZ — restricted areas in uncontrolled airspace (aerodrome
 *     traffic zones around uncontrolled airfields). Same file format and
 *     parser as GRID_CTR, added alongside it because it's the other half
 *     of the grid-based coverage a pilot would expect (controlled +
 *     uncontrolled), at essentially the same fetch/parse cost.
 *
 * Individual named zones (LKR*.json) are still skipped: several of those
 * files are tens to hundreds of megabytes for a single zone identifier
 * (e.g. built-up-area or railway-corridor restrictions with thousands of
 * polygons), too large to reasonably fetch and cache for this purpose —
 * unlike GRID_CTR/GRID_ATZ, there's no cheaper "index-only" version of
 * those files to request instead; the only way to get name/bbox/altitude
 * out of them is to download the same oversized polygon-heavy file, so a
 * lighter-weight secondary layer isn't actually free for that category.
 */

import type { AirspaceProvider, AirspaceZone, BBox } from "./types.js";

const INDEX_URL = "https://aim.rlp.cz/?lang=en&p=uas-gz";
const AIM_ORIGIN = "https://aim.rlp.cz";

/** The two grid datasets we fetch, and how each maps to our common zone shape. */
const GRID_DATASETS = [
  {
    /** Matches the href for GRID_CTR.json on the index page. */
    filePattern: /href="(\/data\/uas\/[^"]*GRID_CTR\.json)"/,
    category: "controlled-airspace",
    label: "Řízený vzdušný prostor",
    logTag: "GRID_CTR",
  },
  {
    /** Matches the href for GRID_ATZ.json on the index page. */
    filePattern: /href="(\/data\/uas\/[^"]*GRID_ATZ\.json)"/,
    category: "uncontrolled-airspace-atz",
    label: "Provozní zóna neřízeného letiště (ATZ)",
    logTag: "GRID_ATZ",
  },
] as const;

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
 * Discover the current download URL for a given grid dataset from the ŘLP
 * index page — the dated "actual" folder changes as new data cycles are
 * published. Returns `null` (rather than throwing) when the pattern isn't
 * found, so one missing dataset doesn't prevent the other from loading.
 */
function discoverDataUrl(html: string, filePattern: RegExp): string | null {
  const match = html.match(filePattern);
  return match ? `${AIM_ORIGIN}${match[1]}` : null;
}

async function fetchIndexHtml(): Promise<string> {
  const res = await fetch(INDEX_URL);
  if (!res.ok) {
    throw new Error(`RLP: failed to fetch index page – ${res.status}`);
  }
  return res.text();
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

/** Download and parse a single grid dataset (GRID_CTR or GRID_ATZ) into AirspaceZone[]. */
async function downloadGrid(
  dataUrl: string,
  dataset: (typeof GRID_DATASETS)[number],
): Promise<AirspaceZone[]> {
  console.log(`RLP: downloading ${dataUrl}`);

  const res = await fetch(dataUrl);
  if (!res.ok) {
    throw new Error(
      `RLP: download failed for ${dataset.logTag} – ${res.status}`,
    );
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
      id: `rlp-${dataset.logTag.toLowerCase()}-${f.properties.ident ?? i}`,
      name: f.properties.vertical_limit
        ? `${dataset.label} (${f.properties.vertical_limit})`
        : dataset.label,
      severity: "restricted",
      geometry: f.geometry,
      altitudeLower: 0,
      altitudeUpper: upper,
      description: f.properties.data_source,
      category: dataset.category,
      source: "rlp",
    });
  });

  console.log(
    `RLP: parsed ${zones.length} ${dataset.logTag} cells${skipped > 0 ? ` (skipped ${skipped} with invalid geometry)` : ""}`,
  );

  return zones;
}

/**
 * Discover and download every grid dataset in `GRID_DATASETS`. Each dataset
 * is fetched independently via `Promise.allSettled` so a failure/missing
 * link for one (e.g. GRID_ATZ renamed upstream) doesn't take down the other.
 */
async function downloadAndParse(): Promise<AirspaceZone[]> {
  const html = await fetchIndexHtml();

  const results = await Promise.allSettled(
    GRID_DATASETS.map(async (dataset) => {
      const dataUrl = discoverDataUrl(html, dataset.filePattern);
      if (!dataUrl) {
        throw new Error(
          `RLP: no ${dataset.logTag}.json link found on index page`,
        );
      }
      return downloadGrid(dataUrl, dataset);
    }),
  );

  const zones: AirspaceZone[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      zones.push(...r.value);
    } else {
      console.error("RLP: failed to fetch/parse a grid dataset:", r.reason);
    }
  }

  if (zones.length === 0) {
    throw new Error("RLP: no grid datasets could be loaded");
  }

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
      console.error("RLP: failed to fetch/parse dataset:", err);
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
