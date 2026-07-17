import { Source, Layer } from "react-map-gl/mapbox";
import { usePreferencesStore } from "@/store/preferencesStore";
import type { CustomMapLayer } from "@droneroute/shared";

// A module-level constant so the selector below returns the SAME array
// reference on every call when there are no saved layers, instead of a
// fresh `[]` literal each time. Zustand (via React's useSyncExternalStore)
// compares selector output by reference — returning a new array every
// render makes every store update look like a change, which broke the
// entire app: React detected the snapshot was never stable and refused to
// finish rendering (regression caught by CI's E2E suite, not unit tests,
// since it only manifests with a real reconciler, not jsdom).
const EMPTY_LAYERS: CustomMapLayer[] = [];

/**
 * Renders each user-added WMS/XYZ tile layer (see the Visualization
 * settings tab) as a Mapbox raster source, in the order they were added —
 * later layers draw on top of earlier ones, both below the mission's own
 * waypoints/POIs/obstacles (this component is mounted early in MapView's
 * child list).
 */
export function CustomLayersOverlay() {
  const customLayers = usePreferencesStore(
    (s) => s.preferences?.visualization?.customLayers ?? EMPTY_LAYERS,
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
