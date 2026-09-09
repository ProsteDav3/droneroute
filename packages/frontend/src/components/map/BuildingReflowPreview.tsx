import { Source, Layer } from "react-map-gl/mapbox";
import { useBuildingReflowProposal } from "@/hooks/useBuildingReflowProposal";

/**
 * Ghost preview of a pending building reflow, drawn inside the map: a dashed
 * amber leader from each affected waypoint's current position to where it
 * would land, with a hollow marker at the destination.
 *
 * Drawn as GeoJSON layers rather than DOM markers on purpose — a real orbit
 * carries dozens of waypoints and this preview redraws on every mouse-move of
 * a vertex drag, which is exactly the workload Mapbox's per-frame DOM marker
 * repositioning handles worst.
 */
export function BuildingReflowPreview() {
  const proposal = useBuildingReflowProposal();

  if (!proposal || proposal.moves.length === 0) return null;

  const leaders: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: proposal.moves.map((move) => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [move.fromLongitude, move.fromLatitude],
          [move.longitude, move.latitude],
        ],
      },
    })),
  };

  const targets: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: proposal.moves.map((move) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [move.longitude, move.latitude] },
    })),
  };

  return (
    <>
      <Source id="building-reflow-leaders" type="geojson" data={leaders}>
        <Layer
          id="building-reflow-leaders-line"
          type="line"
          paint={{
            "line-color": "#fbbf24",
            "line-width": 1.5,
            "line-dasharray": [2, 2],
            "line-opacity": 0.9,
          }}
        />
      </Source>
      <Source id="building-reflow-targets" type="geojson" data={targets}>
        <Layer
          id="building-reflow-targets-circle"
          type="circle"
          paint={{
            "circle-radius": 6,
            "circle-color": "#fbbf24",
            "circle-opacity": 0.25,
            "circle-stroke-color": "#fbbf24",
            "circle-stroke-width": 2,
          }}
        />
      </Source>
    </>
  );
}
