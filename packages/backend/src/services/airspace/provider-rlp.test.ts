import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseVerticalLimitUpper } from "./provider-rlp.js";
import type { AirspaceProvider } from "./types.js";

const INDEX_HTML = `<html><body>
<a href="/data/uas/2026_07_09/actual/LKR311A.json">LKR311A</a>
<a href="/data/uas/2026_07_09/actual/GRID_CTR.json">GRID_CTR</a>
<a href="/data/uas/2026_07_09/actual/GRID_ATZ.json">GRID_ATZ</a>
</body></html>`;

function gridCtrFeature(
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

    it("discovers the current data URL, downloads it, and maps features to AirspaceZone", async () => {
      const feature = gridCtrFeature("110286", "GND - 120 m AGL", [
        [15.0, 49.8],
        [15.02, 49.8],
        [15.02, 49.82],
        [15.0, 49.82],
        [15.0, 49.8],
      ]);
      (fetch as any)
        .mockResolvedValueOnce(textResponse(INDEX_HTML))
        .mockResolvedValueOnce(jsonResponse({ features: [feature] }));

      const zones = await rlpProvider.fetchZones({
        south: 49,
        west: 14,
        north: 50.5,
        east: 16,
      });

      expect(fetch).toHaveBeenNthCalledWith(
        1,
        "https://aim.rlp.cz/?lang=en&p=uas-gz",
      );
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "https://aim.rlp.cz/data/uas/2026_07_09/actual/GRID_CTR.json",
      );
      expect(zones).toHaveLength(1);
      expect(zones[0]).toMatchObject({
        id: "rlp-110286",
        severity: "restricted",
        altitudeLower: 0,
        altitudeUpper: 120,
        source: "rlp",
        category: "controlled-airspace",
      });
    });

    it("filters out zones that don't intersect the requested viewport", async () => {
      const farAway = gridCtrFeature("999999", "GND - 100 m AGL", [
        [12.1, 48.6],
        [12.11, 48.6],
        [12.11, 48.61],
        [12.1, 48.61],
        [12.1, 48.6],
      ]);
      const inView = gridCtrFeature("110286", "GND - 120 m AGL", [
        [15.0, 49.8],
        [15.02, 49.8],
        [15.02, 49.82],
        [15.0, 49.82],
        [15.0, 49.8],
      ]);
      (fetch as any)
        .mockResolvedValueOnce(textResponse(INDEX_HTML))
        .mockResolvedValueOnce(jsonResponse({ features: [farAway, inView] }));

      const zones = await rlpProvider.fetchZones({
        south: 49.7,
        west: 14.9,
        north: 49.9,
        east: 15.1,
      });

      expect(zones.map((z) => z.id)).toEqual(["rlp-110286"]);
    });

    it("skips features with malformed geometry instead of letting them poison every future call", async () => {
      const valid = gridCtrFeature("110286", "GND - 120 m AGL", [
        [15.0, 49.8],
        [15.02, 49.8],
        [15.02, 49.82],
        [15.0, 49.82],
        [15.0, 49.8],
      ]);
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
        .mockResolvedValueOnce(textResponse(INDEX_HTML))
        .mockResolvedValueOnce(
          jsonResponse({
            features: [valid, nullGeometry, emptyCoordinates, wrongType],
          }),
        );

      const bounds = { south: 49, west: 14, north: 50.5, east: 16 };

      // First call: must not throw despite the malformed features being cached.
      const first = await rlpProvider.fetchZones(bounds);
      expect(first.map((z) => z.id)).toEqual(["rlp-110286"]);

      // Second call (served from cache): must also not throw.
      const second = await rlpProvider.fetchZones(bounds);
      expect(second.map((z) => z.id)).toEqual(["rlp-110286"]);
    });

    it("caches the downloaded dataset instead of re-fetching on every call", async () => {
      const feature = gridCtrFeature("110286", "GND - 120 m AGL", [
        [15.0, 49.8],
        [15.02, 49.8],
        [15.02, 49.82],
        [15.0, 49.82],
        [15.0, 49.8],
      ]);
      (fetch as any)
        .mockResolvedValueOnce(textResponse(INDEX_HTML))
        .mockResolvedValueOnce(jsonResponse({ features: [feature] }));

      const bounds = { south: 49, west: 14, north: 50.5, east: 16 };
      await rlpProvider.fetchZones(bounds);
      await rlpProvider.fetchZones(bounds);

      // Index + data file fetched once each, not once per call.
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("returns an empty list (not a thrown error) when the index page has no GRID_CTR link", async () => {
      (fetch as any).mockResolvedValueOnce(
        textResponse("<html><body>no links here</body></html>"),
      );

      const zones = await rlpProvider.fetchZones({
        south: 49,
        west: 14,
        north: 50.5,
        east: 16,
      });

      expect(zones).toEqual([]);
    });
  });
});
