import { describe, it, expect, vi } from "vitest";
import type mapboxgl from "mapbox-gl";
import type { jsPDF } from "jspdf";
import { captureMapSnapshot, addMapSnapshotToPdf } from "./pdfSnapshot";

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

describe("addMapSnapshotToPdf", () => {
  function fakeDoc() {
    return { addImage: vi.fn() } as unknown as jsPDF;
  }

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
