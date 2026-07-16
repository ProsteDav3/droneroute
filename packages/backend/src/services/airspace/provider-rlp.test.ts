import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseVerticalLimitUpper } from "./provider-rlp.js";
import type { AirspaceProvider } from "./types.js";

const INDEX_HTML = `<html><body>
<a href="/data/uas/2026_07_09/actual/LKR311A.json">LKR311A</a>
<a href="/data/uas/2026_07_09/actual/GRID_CTR.json">GRID_CTR</a>
<a href="/data/uas/2026_07_09/actual/GRID_ATZ.json">GRID_ATZ</a>
</body></html>`;

const INDEX_HTML_NO_ATZ = `<html><body>
<a href="/data/uas/2026_07_09/actual/LKR311A.json">LKR311A</a>
<a href="/data/uas/2026_07_09/actual/GRID_CTR.json">GRID_CTR</a>
</body></html>`;

function gridFeature(
  ident: string,
  verticalLimit: string,
  coords: [number, number][],
) {
  return {
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [coords] },
    properties: {
      ident,
      vertical_limit: verticalLimit,
      effective_date: "2025-09-01T00:00:00Z",
      publication: "GRID_CTR",
      data_source: "Řízení letového provozu",
    },
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

function textResponse(body: string) {
  return { ok: true, text: async () => body };
}

const IN_VIEW_COORDS: [number, number][] = [
  [15.0, 49.8],
  [15.02, 49.8],
  [15.02, 49.82],
  [15.0, 49.82],
  [15.0, 49.8],
];

const CZ_VIEWPORT = { south: 49, west: 14, north: 50.5, east: 16 };

describe("provider-rlp", () => {
  describe("parseVerticalLimitUpper", () => {
    it("extracts the numeric AGL limit", () => {
      expect(parseVerticalLimitUpper("GND - 120 m AGL")).toBe(120);
      expect(parseVerticalLimitUpper("GND - 100 m AGL")).toBe(100);
    });

    it("returns undefined for missing or unparsable input", () => {
      expect(parseVerticalLimitUpper(undefined)).toBeUndefined();
      expect(parseVerticalLimitUpper("GND - FL660")).toBeUndefined();
      expect(parseVerticalLimitUpper("")).toBeUndefined();
    });
  });

  describe("fetchZones", () => {
    let rlpProvider: AirspaceProvider;

    beforeEach(async () => {
      vi.resetModules();
      vi.stubGlobal("fetch", vi.fn());
      ({ rlpProvider } = await import("./provider-rlp.js"));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("skips the network entirely when the viewport doesn't overlap the Czech Republic", async () => {
      const zones = await rlpProvider.fetchZones({
        south: 40,
        west: -10,
        north: 41,
        east: -9,
      });
      expect(zones).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("discovers both GRID_CTR and GRID_ATZ, downloads them, and maps features to AirspaceZone", async () => {
      const ctrFeature = gridFeature(
        "110286",
        "GND - 120 m AGL",
        IN_VIEW_COORDS,
      );
      const atzFeature = gridFeature(
        "ATZ-1",
        "GND - 100 m AGL",
        IN_VIEW_COORDS,
      );
      (fetch as any)
        .mockResolvedValueOnce(textResponse(INDEX_HTML))
        .mockResolvedValueOnce(jsonResponse({ features: [ctrFeature] }))
        .mockResolvedValueOnce(jsonResponse({ features: [atzFeature] }));

      const zones = await rlpProvider.fetchZones(CZ_VIEWPORT);

      expect(fetch).toHaveBeenNthCalledWith(
        1,
        "https://aim.rlp.cz/?lang=en&p=uas-gz",
      );
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "https://aim.rlp.cz/data/uas/2026_07_09/actual/GRID_CTR.json",
      );
      expect(fetch).toHaveBeenNthCalledWith(
        3,
        "https://aim.rlp.cz/data/uas/2026_07_09/actual/GRID_ATZ.json",
      );
      expect(zones).toHaveLength(2);
      expect(zones).toContainEqual(
        expect.objectContaining({
          id: "rlp-grid_ctr-110286",
          severity: "restricted",
          altitudeUpper: 120,
          source: "rlp",
          category: "controlled-airspace",
        }),
      );
      expect(zones).toContainEqual(
        expect.objectContaining({
          id: "rlp-grid_atz-ATZ-1",
          severity: "restricted",
          altitudeUpper: 100,
          source: "rlp",
          category: "uncontrolled-airspace-atz",
        }),
      );
    });

    it("still returns GRID_CTR zones when GRID_ATZ is missing from the index page", async () => {
      const feature = gridFeature("110286", "GND - 120 m AGL", IN_VIEW_COORDS);
      (fetch as any)
        .mockResolvedValueOnce(textResponse(INDEX_HTML_NO_ATZ))
        .mockResolvedValueOnce(jsonResponse({ features: [feature] }));

      const zones = await rlpProvider.fetchZones(CZ_VIEWPORT);

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(zones.map((z) => z.id)).toEqual(["rlp-grid_ctr-110286"]);
    });

    it("still returns GRID_ATZ zones when the GRID_CTR download itself fails", async () => {
      const atzFeature = gridFeature(
        "ATZ-1",
        "GND - 100 m AGL",
        IN_VIEW_COORDS,
      );
      (fetch as any)
        .mockResolvedValueOnce(textResponse(INDEX_HTML))
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce(jsonResponse({ features: [atzFeature] }));

      const zones = await rlpProvider.fetchZones(CZ_VIEWPORT);

      expect(zones.map((z) => z.id)).toEqual(["rlp-grid_atz-ATZ-1"]);
    });

    it("filters out zones that don't intersect the requested viewport", async () => {
      const farAway = gridFeature("999999", "GND - 100 m AGL", [
        [12.1, 48.6],
        [12.11, 48.6],
        [12.11, 48.61],
        [12.1, 48.61],
        [12.1, 48.6],
      ]);
      const inView = gridFeature("110286", "GND - 120 m AGL", IN_VIEW_COORDS);
      (fetch as any)
        .mockResolvedValueOnce(textResponse(INDEX_HTML_NO_ATZ))
        .mockResolvedValueOnce(jsonResponse({ features: [farAway, inView] }));

      const zones = await rlpProvider.fetchZones({
        south: 49.7,
        west: 14.9,
        north: 49.9,
        east: 15.1,
      });

      expect(zones.map((z) => z.id)).toEqual(["rlp-grid_ctr-110286"]);
    });

    it("skips features with malformed geometry instead of letting them poison every future call", async () => {
      const valid = gridFeature("110286", "GND - 120 m AGL", IN_VIEW_COORDS);
      const nullGeometry = {
        type: "Feature" as const,
        geometry: null,
        properties: { ident: "bad-1", vertical_limit: "GND - 100 m AGL" },
      };
      const emptyCoordinates = {
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: [] },
        properties: { ident: "bad-2", vertical_limit: "GND - 100 m AGL" },
      };
      const wrongType = {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [15.0, 49.8] },
        properties: { ident: "bad-3", vertical_limit: "GND - 100 m AGL" },
      };
      (fetch as any)
        .mockResolvedValueOnce(textResponse(INDEX_HTML_NO_ATZ))
        .mockResolvedValueOnce(
          jsonResponse({
            features: [valid, nullGeometry, emptyCoordinates, wrongType],
          }),
        );

      // First call: must not throw despite the malformed features being cached.
      const first = await rlpProvider.fetchZones(CZ_VIEWPORT);
      expect(first.map((z) => z.id)).toEqual(["rlp-grid_ctr-110286"]);

      // Second call (served from cache): must also not throw.
      const second = await rlpProvider.fetchZones(CZ_VIEWPORT);
      expect(second.map((z) => z.id)).toEqual(["rlp-grid_ctr-110286"]);
    });

    it("caches the downloaded dataset instead of re-fetching on every call", async () => {
      const feature = gridFeature("110286", "GND - 120 m AGL", IN_VIEW_COORDS);
      (fetch as any)
        .mockResolvedValueOnce(textResponse(INDEX_HTML_NO_ATZ))
        .mockResolvedValueOnce(jsonResponse({ features: [feature] }));

      await rlpProvider.fetchZones(CZ_VIEWPORT);
      await rlpProvider.fetchZones(CZ_VIEWPORT);

      // Index + GRID_CTR data fetched once each, not once per call.
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("returns an empty list (not a thrown error) when the index page has no grid dataset links", async () => {
      (fetch as any).mockResolvedValueOnce(
        textResponse("<html><body>no links here</body></html>"),
      );

      const zones = await rlpProvider.fetchZones(CZ_VIEWPORT);

      expect(zones).toEqual([]);
    });
  });
});
