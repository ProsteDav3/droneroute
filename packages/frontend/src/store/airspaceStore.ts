import { create } from "zustand";
import { api } from "@/lib/api";

export type ZoneSeverity = "prohibited" | "restricted";

export interface AirspaceZone {
  id: string;
  name: string;
  severity: ZoneSeverity;
  geometry: GeoJSON.Geometry;
  altitudeLower?: number;
  altitudeUpper?: number;
  description?: string;
  category?: string;
  source: string;
}

/** Provider metadata matching the backend. */
export interface AirspaceProviderInfo {
  id: string;
  name: string;
  description: string;
}

/** Static list of known providers with UI metadata. */
export const AIRSPACE_PROVIDERS: AirspaceProviderInfo[] = [
  {
    id: "enaire",
    name: "Spain (ENAIRE)",
    description: "Prohibited and restricted airspace zones",
  },
  {
    id: "dgac",
    name: "France (DGAC)",
    description: "UAS restriction zones — open category",
  },
  {
    id: "nats",
    name: "United Kingdom (NATS)",
    description: "Flight restriction zones around aerodromes",
  },
];

interface AirspaceState {
  /** Set of enabled provider ids. */
  enabledProviders: Set<string>;
  /** Derived convenience: true when at least one provider is enabled. */
  enabled: boolean;
  zones: AirspaceZone[];
  isLoading: boolean;
  /** The bounds we already fetched (padded). Skip refetch if viewport fits inside. */
  cachedBounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  } | null;
  /** Provider ids that were active on the last fetch — forces refetch on change. */
  cachedProviders: string | null;

  setProviderEnabled: (providerId: string, v: boolean) => void;
  /** Toggle all providers on/off at once (for keyboard shortcut). */
  setEnabled: (v: boolean) => void;
  fetchForBounds: (
    south: number,
    west: number,
    north: number,
    east: number,
  ) => Promise<void>;
}

/** Pad bounds by ~50 % so small pans don't trigger refetches. */
function pad(s: number, w: number, n: number, e: number) {
  const latPad = (n - s) * 0.5;
  const lngPad = (e - w) * 0.5;
  return {
    south: s - latPad,
    west: w - lngPad,
    north: n + latPad,
    east: e + lngPad,
  };
}

function contains(
  cached: { south: number; west: number; north: number; east: number },
  s: number,
  w: number,
  n: number,
  e: number,
) {
  return (
    s >= cached.south &&
    w >= cached.west &&
    n <= cached.north &&
    e <= cached.east
  );
}

function providerKey(providers: Set<string>): string {
  return [...providers].sort().join(",");
}

export const useAirspaceStore = create<AirspaceState>((set, get) => ({
  enabledProviders: new Set<string>(),
  enabled: false,
  zones: [],
  isLoading: false,
  cachedBounds: null,
  cachedProviders: null,

  setProviderEnabled(providerId, v) {
    const next = new Set(get().enabledProviders);
    if (v) {
      next.add(providerId);
    } else {
      next.delete(providerId);
    }
    const enabled = next.size > 0;
    set({
      enabledProviders: next,
      enabled,
      // Clear cache so next fetchForBounds re-queries with updated providers
      zones: [],
      cachedBounds: null,
      cachedProviders: null,
    });
  },

  setEnabled(v) {
    if (v) {
      // Enable all providers
      const next = new Set(AIRSPACE_PROVIDERS.map((p) => p.id));
      set({ enabledProviders: next, enabled: true });
    } else {
      set({
        enabledProviders: new Set(),
        enabled: false,
        zones: [],
        cachedBounds: null,
        cachedProviders: null,
      });
    }
  },

  async fetchForBounds(south, west, north, east) {
    const {
      enabled,
      isLoading,
      cachedBounds,
      enabledProviders,
      cachedProviders,
    } = get();
    if (!enabled || isLoading) return;

    const currentKey = providerKey(enabledProviders);

    if (
      cachedBounds &&
      cachedProviders === currentKey &&
      contains(cachedBounds, south, west, north, east)
    )
      return;

    const padded = pad(south, west, north, east);
    set({ isLoading: true });

    try {
      const providersParam = [...enabledProviders].join(",");
      const data = await api.get<{ zones: AirspaceZone[] }>(
        `/airspace/zones?south=${padded.south}&west=${padded.west}&north=${padded.north}&east=${padded.east}&providers=${providersParam}`,
      );
      set({
        zones: data.zones,
        cachedBounds: padded,
        cachedProviders: currentKey,
      });
    } catch (err) {
      console.error("Failed to fetch airspace zones:", err);
    } finally {
      set({ isLoading: false });
    }
  },
}));
