import { Source, Layer } from "react-map-gl/mapbox";
import { usePreferencesStore } from "@/store/preferencesStore";

/**
 * Renders each user-added WMS/XYZ tile layer (see the Visualization
 * settings tab) as a Mapbox raster source, in the order they were added —
 * later layers draw on top of earlier ones, both below the mission's own
 * waypoints/POIs/obstacles (this component is mounted early in MapView's
 * child list).
 */
export function CustomLayersOverlay() {
  const customLayers = usePreferencesStore(
    (s) => s.preferences?.visualization?.customLayers ?? [],
  );
  const visibleLayers = customLayers.filter((l) => l.visible);

  return (
    <>
      {visibleLayers.map((layer) => (
        <Source
          key={layer.id}
          id={`custom-layer-${layer.id}`}
          type="raster"
          tiles={[layer.urlTemplate]}
          tileSize={256}
        >
          <Layer
            id={`custom-layer-${layer.id}-layer`}
            type="raster"
            paint={{ "raster-opacity": 0.7 }}
          />
        </Source>
      ))}
    </>
  );
}
