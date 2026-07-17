/**
 * DGAC airspace provider – France.
 *
 * Queries the Géoplateforme WFS (data.geopf.fr) to fetch drone restriction
 * zones published by the DGAC (Direction Générale de l'Aviation Civile).
 *
 * The single layer "carte_restriction_drones_lf" contains all UAS restriction
 * zones for metropolitan France and overseas territories.  Each feature has a
 * `limite` field describing the restriction type and an optional `remarque`.
 */

import type { AirspaceProvider, AirspaceZone, BBox } from "./types.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WFS_BASE = "https://data.geopf.fr/wfs/ows";
const LAYER = "TRANSPORTS.DRONES.RESTRICTIONS:carte_restriction_drones_lf";
const MAX_FEATURES = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map the `limite` text to a severity level. */
function parseSeverity(limite: string): "prohibited" | "restricted" {
  const lower = limite.toLowerCase();
  if (lower.includes("interdit")) return "prohibited";
  return "restricted";
}

/** Derive a category tag from the `limite` text. */
function parseCategory(limite: string): string {
  const lower = limite.toLowerCase();
  if (lower.includes("interdit")) return "no-fly";
  if (lower.includes("hauteur")) return "height-restriction";
  return "restriction";
}

/** Strip the footnote marker (* or **) from `limite` values. */
function cleanLimite(raw: string): string {
  return raw.replace(/\s*\*+\s*$/, "").trim();
}

/**
 * Build the WFS GetFeature URL for the given bounding box.
 *
 * Despite SRSNAME=EPSG:4326, this WFS server expects the BBOX in
 * longitude/latitude order: minX,minY,maxX,maxY,EPSG:4326.
 */
function buildUrl(bounds: BBox): string {
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: LAYER,
    OUTPUTFORMAT: "application/json",
    SRSNAME: "EPSG:4326",
    COUNT: String(MAX_FEATURES),
    BBOX: `${bounds.west},${bounds.south},${bounds.east},${bounds.north},EPSG:4326`,
  });
  return `${WFS_BASE}?${params}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const dgacProvider: AirspaceProvider = {
  id: "dgac",
  name: "DGAC (France)",

  async fetchZones(bounds: BBox): Promise<AirspaceZone[]> {
    const url = buildUrl(bounds);
    const res = await fetch(url);

    if (!res.ok) {
      logger.error(`DGAC: WFS request failed – ${res.status}`);
      return [];
    }

    const json = (await res.json()) as {
      features?: Array<{
        id?: string;
        geometry: Record<string, unknown>;
        properties?: Record<string, unknown>;
      }>;
    };

    if (!json.features) return [];

    return json.features
      .filter((f) => f.geometry != null)
      .map((f): AirspaceZone => {
        const p = f.properties ?? {};
        const rawLimite = String(p["limite"] ?? "");
        const limite = cleanLimite(rawLimite);
        const remarque = p["remarque"] ? String(p["remarque"]) : undefined;

        return {
          id: String(f.id ?? ""),
          name: limite,
          severity: parseSeverity(rawLimite),
          geometry: f.geometry,
          description: remarque,
          category: parseCategory(rawLimite),
          source: "dgac",
        };
      });
  },
};
