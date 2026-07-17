import { describe, it, expect, vi } from "vitest";
import type mapboxgl from "mapbox-gl";
import type { jsPDF } from "jspdf";
import {
  captureMapSnapshot,
  captureMissionMapSnapshot,
  addMapSnapshotToPdf,
} from "./pdfSnapshot";

function fakeMap(width: number, height: number, dataUrl: string): mapboxgl.Map {
  return {
    getCanvas: () => ({
      toDataURL: vi.fn(() => dataUrl),
      width,
      height,
    }),
  } as unknown as mapboxgl.Map;
}

describe("captureMapSnapshot", () => {
  it("returns the canvas PNG data URL and pixel dimensions", () => {
    const map = fakeMap(800, 450, "data:image/png;base64,AAAA");
    const snapshot = captureMapSnapshot(map);

    expect(snapshot.dataUrl).toBe("data:image/png;base64,AAAA");
    expect(snapshot.width).toBe(800);
    expect(snapshot.height).toBe(450);
  });

  it("requests a PNG (not the default JPEG) so the report keeps a transparent/crisp background", () => {
    const canvas = {
      toDataURL: vi.fn(() => "data:image/png;base64,AAAA"),
      width: 800,
      height: 450,
    };
    const map = { getCanvas: () => canvas } as unknown as mapboxgl.Map;

    captureMapSnapshot(map);

    expect(canvas.toDataURL).toHaveBeenCalledWith("image/png");
  });
});

describe("captureMissionMapSnapshot", () => {
  function fakeFittableMap() {
    const calls: Record<string, unknown[]> = {
      fitBounds: [],
      jumpTo: [],
      once: [],
    };
    let idleCallback: (() => void) | null = null;
    const map = {
      getCenter: () => ({ lng: 10, lat: 20 }),
      getZoom: () => 5,
      getBearing: () => 0,
      getPitch: () => 0,
      getCanvas: () => ({
        toDataURL: vi.fn(() => "data:image/png;base64,AAAA"),
        width: 800,
        height: 450,
      }),
      fitBounds: vi.fn((...args: unknown[]) => calls.fitBounds.push(args)),
      jumpTo: vi.fn((...args: unknown[]) => calls.jumpTo.push(args)),
      once: vi.fn((event: string, cb: () => void) => {
        calls.once.push([event]);
        if (event === "idle") idleCallback = cb;
      }),
      project: vi.fn(({ 0: lng, 1: lat }: [number, number]) => ({
        x: lng * 10,
        y: lat * 10,
      })),
      // Test-only escape hatch so it fires without a real Mapbox instance.
      __fireIdle: () => idleCallback?.(),
    };
    return { map, calls };
  }

  it("fits the map to the given bounds and restores the original view afterward", async () => {
    const { map, calls } = fakeFittableMap();
    const points: [number, number][] = [
      [14, 50],
      [14.01, 50.01],
    ];

    const promise = captureMissionMapSnapshot(
      map as unknown as mapboxgl.Map,
      points,
      [{ latitude: 50, longitude: 14 }],
    );
    map.__fireIdle();
    const snapshot = await promise;

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [14, 50],
        [14.01, 50.01],
      ],
      { padding: 60, maxZoom: 18, animate: false },
    );
    expect(map.jumpTo).toHaveBeenCalledWith({
      center: { lng: 10, lat: 20 },
      zoom: 5,
      bearing: 0,
      pitch: 0,
    });
    expect(snapshot.dataUrl).toBe("data:image/png;base64,AAAA");
    expect(calls.jumpTo).toHaveLength(1);
  });

  it("projects each waypoint's pixel position at capture time", async () => {
    const { map } = fakeFittableMap();
    const promise = captureMissionMapSnapshot(
      map as unknown as mapboxgl.Map,
      [[14, 50]],
      [
        { latitude: 50, longitude: 14 },
        { latitude: 51, longitude: 15 },
      ],
    );
    map.__fireIdle();
    const snapshot = await promise;

    expect(snapshot.waypointPixels).toHaveLength(2);
    expect(snapshot.waypointPixels?.[0]).toMatchObject({
      x: 140,
      y: 500,
      index: 0,
    });
    expect(snapshot.waypointPixels?.[0].segmentDistanceM).toBeUndefined();
    expect(snapshot.waypointPixels?.[1]).toMatchObject({
      x: 150,
      y: 510,
      index: 1,
    });
    // 50,14 -> 51,15: a real ~1 degree diagonal hop, roughly 132km.
    expect(snapshot.waypointPixels?.[1].segmentDistanceM).toBeCloseTo(
      131780,
      -3,
    );
  });

  it("still restores the original view even if projecting throws", async () => {
    const { map } = fakeFittableMap();
    map.project = vi.fn(() => {
      throw new Error("projection failed");
    });

    const promise = captureMissionMapSnapshot(
      map as unknown as mapboxgl.Map,
      [[14, 50]],
      [{ latitude: 50, longitude: 14 }],
    );
    map.__fireIdle();

    await expect(promise).rejects.toThrow("projection failed");
    expect(map.jumpTo).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain capture without moving the view when there are no bounds points", async () => {
    const { map } = fakeFittableMap();

    const snapshot = await captureMissionMapSnapshot(
      map as unknown as mapboxgl.Map,
      [],
      [],
    );

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(snapshot.dataUrl).toBe("data:image/png;base64,AAAA");
    expect(snapshot.waypointPixels).toBeUndefined();
  });
});

describe("addMapSnapshotToPdf", () => {
  function fakeDoc() {
    return {
      addImage: vi.fn(),
      setFillColor: vi.fn(),
      setTextColor: vi.fn(),
      setFontSize: vi.fn(),
      getFontSize: vi.fn(() => 10),
      getTextColor: vi.fn(() => "#000000"),
      getTextWidth: vi.fn(() => 8),
      circle: vi.fn(),
      roundedRect: vi.fn(),
      text: vi.fn(),
    } as unknown as jsPDF;
  }

  it("draws a numbered marker for each waypoint, scaled to the placed image size", () => {
    const doc = fakeDoc();
    const snapshot = {
      dataUrl: "data:image/png;base64,AAAA",
      width: 800,
      height: 400,
      waypointPixels: [
        { x: 400, y: 200, index: 0 }, // dead center of the source canvas
        { x: 0, y: 0, index: 1 }, // top-left corner
      ],
    };

    // 800x400 at maxWidth 180 -> placed at 180x90
    addMapSnapshotToPdf(doc, snapshot, 14, 100, 180);

    // Center marker: 14 + 400/800*180 = 104, 100 + 200/400*90 = 145
    expect(doc.circle).toHaveBeenCalledWith(104, 145, 1.6, "F");
    expect(doc.text).toHaveBeenCalledWith("1", 104, 145.6, {
      align: "center",
    });
    // Top-left marker: right at the image's own origin
    expect(doc.circle).toHaveBeenCalledWith(14, 100, 1.6, "F");
    expect(doc.text).toHaveBeenCalledWith("2", 14, 100.6, {
      align: "center",
    });
  });

  it("draws a distance label at the midpoint of each segment that has one", () => {
    const doc = fakeDoc();
    const snapshot = {
      dataUrl: "data:image/png;base64,AAAA",
      width: 800,
      height: 400,
      waypointPixels: [
        { x: 0, y: 0, index: 0 },
        { x: 400, y: 200, index: 1, segmentDistanceM: 42 },
      ],
    };

    // 800x400 at maxWidth 180 -> placed at 180x90; midpoint of the two
    // markers in source pixels is (200,100) -> 14 + 200/800*180 = 59,
    // 100 + 100/400*90 = 122.5
    addMapSnapshotToPdf(doc, snapshot, 14, 100, 180);

    expect(doc.text).toHaveBeenCalledWith("42 m", 59, 123.4, {
      align: "center",
    });
    expect(doc.roundedRect).toHaveBeenCalledWith(
      54.2,
      120.6,
      9.6,
      3,
      0.5,
      0.5,
      "F",
    );
  });

  it("does not draw a distance label for the first waypoint (no incoming segment)", () => {
    const doc = fakeDoc();
    const snapshot = {
      dataUrl: "data:image/png;base64,AAAA",
      width: 800,
      height: 400,
      waypointPixels: [{ x: 400, y: 200, index: 0 }],
    };

    addMapSnapshotToPdf(doc, snapshot, 14, 100, 180);

    expect(doc.roundedRect).not.toHaveBeenCalled();
  });

  it("skips a marker that falls outside the placed image", () => {
    const doc = fakeDoc();
    const snapshot = {
      dataUrl: "data:image/png;base64,AAAA",
      width: 800,
      height: 400,
      waypointPixels: [{ x: -50, y: 200, index: 0 }],
    };

    addMapSnapshotToPdf(doc, snapshot, 14, 100, 180);

    expect(doc.circle).not.toHaveBeenCalled();
  });

  it("does not touch marker-drawing state when there are no waypoint pixels", () => {
    const doc = fakeDoc();
    const snapshot = {
      dataUrl: "data:image/png;base64,AAAA",
      width: 800,
      height: 400,
    };

    addMapSnapshotToPdf(doc, snapshot, 14, 100, 180);

    expect(doc.circle).not.toHaveBeenCalled();
    expect(doc.setFillColor).not.toHaveBeenCalled();
  });

  it("scales a wide snapshot to the requested width, preserving aspect ratio", () => {
    const doc = fakeDoc();
    const snapshot = {
      dataUrl: "data:image/png;base64,AAAA",
      width: 800,
      height: 400,
    };

    const nextY = addMapSnapshotToPdf(doc, snapshot, 14, 100, 180);

    // 800x400 has a 0.5 aspect ratio -> 180 wide becomes 90 tall
    expect(doc.addImage).toHaveBeenCalledWith(
      snapshot.dataUrl,
      "PNG",
      14,
      100,
      180,
      90,
    );
    expect(nextY).toBe(190);
  });

  it("clamps to maxHeight and derives width from it when the snapshot is tall", () => {
    const doc = fakeDoc();
    // 400x800 has a 2.0 aspect ratio -> at maxWidth 180 it would be 360 tall,
    // which exceeds a 150 maxHeight, so height must clamp and width shrink.
    const snapshot = {
      dataUrl: "data:image/png;base64,AAAA",
      width: 400,
      height: 800,
    };

    const nextY = addMapSnapshotToPdf(doc, snapshot, 14, 20, 180, 150);

    expect(doc.addImage).toHaveBeenCalledWith(
      snapshot.dataUrl,
      "PNG",
      14,
      20,
      75,
      150,
    );
    expect(nextY).toBe(170);
  });

  it("does not throw for a square snapshot with no maxHeight given", () => {
    const doc = fakeDoc();
    const snapshot = {
      dataUrl: "data:image/png;base64,AAAA",
      width: 500,
      height: 500,
    };

    expect(() => addMapSnapshotToPdf(doc, snapshot, 0, 0, 100)).not.toThrow();
    expect(doc.addImage).toHaveBeenCalledWith(
      snapshot.dataUrl,
      "PNG",
      0,
      0,
      100,
      100,
    );
  });
});
