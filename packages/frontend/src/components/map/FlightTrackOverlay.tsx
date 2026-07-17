import { useMemo } from "react";
import { Source, Layer } from "react-map-gl/mapbox";
import { useFlightTrackStore } from "@/store/flightTrackStore";

/**
 * Draws the actually-flown GPS trace of a selected recorded flight-track
 * session as a solid amber line, distinct from the dashed, per-waypoint
 * colored planned route drawn by `FlightPath` in MapView.tsx — the whole
 * point of recording is to see where the two diverge.
 */
export function FlightTrackOverlay() {
  const trackPoints = useFlightTrackStore((s) => s.trackPoints);

  const geojson = useMemo(() => {
    if (trackPoints.length < 2) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: trackPoints.map((p) => [p.longitude, p.latitude]),
      },
    };
  }, [trackPoints]);

  if (!geojson) return null;

  return (
    <Source id="flight-track" type="geojson" data={geojson}>
      <Layer
        id="flight-track-line"
        type="line"
        paint={{
          "line-color": "#f59e0b",
          "line-width": 3,
          "line-opacity": 0.85,
        }}
        layout={{
          "line-cap": "round",
          "line-join": "round",
        }}
      />
    </Source>
  );
}
