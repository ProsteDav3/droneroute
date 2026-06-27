import { describe, it, expect } from "vitest";
import { DEFAULT_MAP_VIEW } from "@droneroute/shared";
import { resolveDefaultMapView } from "./config.js";

describe("resolveDefaultMapView", () => {
  it("returns the built-in default when DEFAULT_MAP_VIEW is unset", () => {
    expect(resolveDefaultMapView({})).toEqual(DEFAULT_MAP_VIEW);
  });

  it("returns the built-in default when DEFAULT_MAP_VIEW is empty", () => {
    expect(resolveDefaultMapView({ DEFAULT_MAP_VIEW: "  " })).toEqual(
      DEFAULT_MAP_VIEW,
    );
  });

  it("parses lat,lng,zoom", () => {
    expect(
      resolveDefaultMapView({ DEFAULT_MAP_VIEW: "51.5072,-0.1276,10" }),
    ).toEqual({ latitude: 51.5072, longitude: -0.1276, zoom: 10 });
  });

  it("defaults the zoom when only lat,lng is given", () => {
    expect(
      resolveDefaultMapView({ DEFAULT_MAP_VIEW: "51.5072, -0.1276" }),
    ).toEqual({
      latitude: 51.5072,
      longitude: -0.1276,
      zoom: DEFAULT_MAP_VIEW.zoom,
    });
  });

  it("falls back when the value has too many or too few parts", () => {
    expect(resolveDefaultMapView({ DEFAULT_MAP_VIEW: "41" })).toEqual(
      DEFAULT_MAP_VIEW,
    );
    expect(
      resolveDefaultMapView({ DEFAULT_MAP_VIEW: "41,2,13,extra" }),
    ).toEqual(DEFAULT_MAP_VIEW);
  });

  it("falls back when a part is empty or non-numeric", () => {
    expect(resolveDefaultMapView({ DEFAULT_MAP_VIEW: "41,,13" })).toEqual(
      DEFAULT_MAP_VIEW,
    );
    expect(resolveDefaultMapView({ DEFAULT_MAP_VIEW: "north,2,13" })).toEqual(
      DEFAULT_MAP_VIEW,
    );
  });

  it("falls back when any value is out of range", () => {
    expect(resolveDefaultMapView({ DEFAULT_MAP_VIEW: "91,2,13" })).toEqual(
      DEFAULT_MAP_VIEW,
    ); // latitude > 90
    expect(resolveDefaultMapView({ DEFAULT_MAP_VIEW: "41,-200,13" })).toEqual(
      DEFAULT_MAP_VIEW,
    ); // longitude < -180
    expect(resolveDefaultMapView({ DEFAULT_MAP_VIEW: "41,2,30" })).toEqual(
      DEFAULT_MAP_VIEW,
    ); // zoom > 22
  });

  it("accepts boundary values", () => {
    expect(resolveDefaultMapView({ DEFAULT_MAP_VIEW: "-90,180,0" })).toEqual({
      latitude: -90,
      longitude: 180,
      zoom: 0,
    });
  });
});
