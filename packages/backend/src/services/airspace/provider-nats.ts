/**
 * NATS airspace provider – United Kingdom.
 *
 * Downloads the UAS Flight Restriction dataset published by NATS as a KMZ
 * file (ZIP containing KML).  The dataset is updated every 28 days on the
 * AIRAC cycle.
 *
 * Strategy: lazy-fetch on first request that overlaps UK bounds, parse the
 * KML into AirspaceZone[], cache in memory with a 24-hour TTL.
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

import type { AirspaceProvider, AirspaceZone, BBox } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * NATS publishes the KML dataset as a ZIP containing a KMZ (which is itself
 * a ZIP containing a KML).  The URL changes each AIRAC cycle.  We use the
 * latest available dataset; the download page lists two cycles (current and
 * next).  We try the current one first.
 */
const DATASET_INDEX_URL =
  "https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/digital-datasets/";

/** Rough bounding box around the UK + Crown Dependencies. */
const UK_BOUNDS: BBox = {
  south: 49.0,
  west: -8.0,
  north: 61.0,
  east: 2.0,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface Cache {
  zones: AirspaceZone[];
  fetchedAt: number;
}

let cache: Cache | null = null;
let fetchInProgress: Promise<AirspaceZone[]> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    const zb = zoneBBox(ring);
    return boundsOverlap(zb, bounds);
  }
  if (geom.type === "MultiPolygon") {
    for (const polygon of geom.coordinates as number[][][][]) {
      const ring = polygon[0];
      const zb = zoneBBox(ring);
      if (boundsOverlap(zb, bounds)) return true;
    }
  }
  return false;
}

/**
 * Parse KML coordinate string "lng,lat,alt lng,lat,alt ..." into
 * GeoJSON-style [lng, lat][] array.
 */
function parseKmlCoords(text: string): number[][] {
  return text
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const parts = tuple.split(",").map(Number);
      return [parts[0], parts[1]]; // [lng, lat]
    })
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
}

/**
 * Extract the KML file from the nested ZIP structure:
 * download.zip → *.kmz → *.kml
 */
async function extractKml(zipBuffer: ArrayBuffer): Promise<string> {
  const outerZip = await JSZip.loadAsync(zipBuffer);

  // Find the KMZ inside the outer ZIP
  const kmzEntry = Object.values(outerZip.files).find(
    (f) => f.name.endsWith(".kmz") || f.name.endsWith(".kml"),
  );

  if (!kmzEntry) {
    throw new Error("NATS: no KMZ/KML found in ZIP");
  }

  if (kmzEntry.name.endsWith(".kml")) {
    return kmzEntry.async("text");
  }

  // KMZ is itself a ZIP containing a KML
  const kmzBuffer = await kmzEntry.async("arraybuffer");
  const innerZip = await JSZip.loadAsync(kmzBuffer);

  const kmlEntry = Object.values(innerZip.files).find((f) =>
    f.name.endsWith(".kml"),
  );
  if (!kmlEntry) {
    throw new Error("NATS: no KML found in KMZ");
  }

  return kmlEntry.async("text");
}

/**
 * Parse a KML Placemark element into polygon coordinates.
 * Handles both <Polygon> and <MultiGeometry> with multiple polygons.
 */
function extractPolygons(placemark: Record<string, unknown>): number[][][][] {
  const polygons: number[][][][] = [];

  const extractFromPolygon = (poly: Record<string, unknown>) => {
    const outer = (poly?.["outerBoundaryIs"] as Record<string, unknown>)?.[
      "LinearRing"
    ] as Record<string, unknown> | undefined;
    const coordsText = outer?.["coordinates"];
    if (typeof coordsText === "string") {
      const ring = parseKmlCoords(coordsText);
      if (ring.length >= 3) {
        polygons.push([ring]);
      }
    }
  };

  // Direct <Polygon>
  if (placemark["Polygon"]) {
    const p = placemark["Polygon"] as Record<string, unknown>;
    extractFromPolygon(p);
  }

  // <MultiGeometry>
  if (placemark["MultiGeometry"]) {
    const mg = placemark["MultiGeometry"] as Record<string, unknown>;
    const items = mg["Polygon"];
    if (Array.isArray(items)) {
      for (const p of items) extractFromPolygon(p as Record<string, unknown>);
    } else if (items) {
      extractFromPolygon(items as Record<string, unknown>);
    }
  }

  return polygons;
}

/**
 * Discover the latest KML download URL from the NATS digital datasets page.
 */
async function discoverDownloadUrl(): Promise<string> {
  const res = await fetch(DATASET_INDEX_URL);
  if (!res.ok) {
    throw new Error(`NATS: failed to fetch dataset index – ${res.status}`);
  }
  const html = await res.text();

  // Look for KML download links in the page
  const kmlLinkRegex = /href="([^"]*UAS[^"]*KML[^"]*\.zip)"/gi;
  const matches = [...html.matchAll(kmlLinkRegex)];

  if (matches.length === 0) {
    throw new Error("NATS: no KML download link found on dataset page");
  }

  // Take the first match (current AIRAC cycle)
  let href = matches[0][1];

  // Make absolute URL if relative
  if (href.startsWith("/")) {
    href = `https://nats-uk.ead-it.com${href}`;
  }

  return href;
}

/**
 * Download and parse the NATS KMZ dataset into AirspaceZone[].
 */
async function downloadAndParse(): Promise<AirspaceZone[]> {
  console.log("NATS: discovering latest dataset URL...");
  const downloadUrl = await discoverDownloadUrl();
  console.log(`NATS: downloading ${downloadUrl}`);

  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`NATS: download failed – ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  console.log(`NATS: downloaded ${(buffer.byteLength / 1024).toFixed(0)} KB`);

  const kmlText = await extractKml(buffer);
  console.log(`NATS: extracted KML (${(kmlText.length / 1024).toFixed(0)} KB)`);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (tagName: string) =>
      tagName === "Placemark" || tagName === "Polygon",
  });

  const doc = parser.parse(kmlText);

  // Navigate KML structure: kml > Document > (Folder >)* Placemark
  const kml = doc["kml"] as Record<string, unknown> | undefined;
  const document = kml?.["Document"] as Record<string, unknown> | undefined;
  if (!document) {
    console.error("NATS: unexpected KML structure");
    return [];
  }

  // Collect placemarks from Document and nested Folders
  const placemarks: Record<string, unknown>[] = [];

  const collectPlacemarks = (node: Record<string, unknown>) => {
    if (node["Placemark"]) {
      const items = node["Placemark"];
      if (Array.isArray(items)) {
        placemarks.push(...(items as Record<string, unknown>[]));
      } else {
        placemarks.push(items as Record<string, unknown>);
      }
    }
    if (node["Folder"]) {
      const folders = Array.isArray(node["Folder"])
        ? node["Folder"]
        : [node["Folder"]];
      for (const folder of folders) {
        collectPlacemarks(folder as Record<string, unknown>);
      }
    }
  };

  collectPlacemarks(document);
  console.log(`NATS: found ${placemarks.length} placemarks`);

  const zones: AirspaceZone[] = [];

  for (const pm of placemarks) {
    const polygons = extractPolygons(pm);
    if (polygons.length === 0) continue;

    const name = String(pm["name"] ?? "UK UAS restriction");
    const description = pm["description"]
      ? String(pm["description"])
      : undefined;

    const geometry =
      polygons.length === 1
        ? { type: "Polygon" as const, coordinates: polygons[0] }
        : { type: "MultiPolygon" as const, coordinates: polygons };

    zones.push({
      id: `nats-${zones.length}`,
      name,
      severity: "prohibited",
      geometry,
      description,
      category: "airport",
      source: "nats",
    });
  }

  console.log(`NATS: parsed ${zones.length} zones`);
  return zones;
}

/**
 * Get cached zones, fetching if needed.
 */
async function getCachedZones(): Promise<AirspaceZone[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.zones;
  }

  // Deduplicate concurrent fetches
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
      console.error("NATS: failed to fetch/parse dataset:", err);
      return [];
    });

  return fetchInProgress;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const natsProvider: AirspaceProvider = {
  id: "nats",
  name: "NATS (United Kingdom)",

  async fetchZones(bounds: BBox): Promise<AirspaceZone[]> {
    // Quick check: skip if viewport doesn't overlap UK at all
    if (!boundsOverlap(bounds, UK_BOUNDS)) {
      return [];
    }

    const allZones = await getCachedZones();

    // Filter to zones that intersect the requested bounds
    return allZones.filter((z) => zoneIntersects(z, bounds));
  },
};
