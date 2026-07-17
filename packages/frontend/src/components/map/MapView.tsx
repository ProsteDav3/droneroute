import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import Map, {
  Source,
  Layer,
  Popup,
  useMap,
  MapMouseEvent,
} from "react-map-gl/mapbox";
import type { LngLatBoundsLike } from "mapbox-gl";
import mapboxgl from "mapbox-gl";
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css";
import { useMissionStore } from "@/store/missionStore";
import { useConfigStore } from "@/store/configStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { getObstacleWarnings, mergeBuildingFootprints } from "@/lib/geo";
import { valueToGradientColor } from "@/lib/colorScale";
import { WaypointMarker } from "./WaypointMarker";
import { PoiMarker } from "./PoiMarker";
import { MapToolbar } from "./MapToolbar";
import { TemplateDrawHandler } from "./TemplateDrawHandler";
import { PencilDrawHandler } from "./PencilDrawHandler";
import { SolarDrawHandler } from "./SolarDrawHandler";
import { CorridorDrawHandler } from "./CorridorDrawHandler";
import { TurbineDrawHandler } from "./TurbineDrawHandler";
import { ObstacleDrawHandler } from "./ObstacleDrawHandler";
import { ObstaclePolygon } from "./ObstaclePolygon";
import { BuildingDrawHandler } from "./BuildingDrawHandler";
import { BuildingPolygon } from "./BuildingPolygon";
import { AirspaceOverlay } from "./AirspaceOverlay";
import { FlightTrackOverlay } from "./FlightTrackOverlay";
import { CustomLayersOverlay } from "./CustomLayersOverlay";
import { CameraFrustum } from "./CameraFrustum";
import { DjiTelemetryMarkers } from "./DjiTelemetryMarkers";
import { useFlightSimulationStore } from "@/store/flightSimulationStore";
import {
  buildSimulationFrames,
  frameToWaypoint,
  FRAMES_PER_SEGMENT,
} from "@/lib/flightSimulation";
import { MeasureToolHandler } from "./MeasureToolHandler";
import { useMeasureStore } from "@/store/measureStore";
import { Triangle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BuildingFragment {
  height: number | null;
  vertices: [number, number][]; // [lat, lng][]
}

interface BuildingPopupData {
  lng: number;
  lat: number;
  /** One entry normally; more when Shift-click accumulated adjacent
   * fragments of the same real-world building for merging. */
  fragments: BuildingFragment[];
}

/** Sets up 3D buildings layer and syncs 2D/3D pitch/rotation. */
function SceneSetup({ is3D, mapStyle }: { is3D: boolean; mapStyle: string }) {
  const { current: map } = useMap();

  // Buildings layer (re-added on style changes)
  useEffect(() => {
    if (!map) return;

    const setup = () => {
      const m = map.getMap();
      if (!m.isStyleLoaded()) return;
      if (m.getLayer("3d-buildings")) return;

      // Ensure we have a source with building data.
      // The "composite" source in satellite styles may not include the
      // building source-layer, so add a dedicated vector tile source.
      let buildingSource = "composite";
      const style = m.getStyle();
      const compositeSource = style?.sources?.["composite"] as any;
      const hasBuildingInComposite = compositeSource?.url?.includes(
        "mapbox.mapbox-streets",
      );
      if (!hasBuildingInComposite) {
        if (!m.getSource("mapbox-streets")) {
          m.addSource("mapbox-streets", {
            type: "vector",
            url: "mapbox://mapbox.mapbox-streets-v8",
          });
        }
        buildingSource = "mapbox-streets";
      }

      const layers = style?.layers;
      let labelLayerId: string | undefined;
      if (layers) {
        for (const layer of layers) {
          if (
            layer.type === "symbol" &&
            (layer as any).layout?.["text-field"]
          ) {
            labelLayerId = layer.id;
            break;
          }
        }
      }

      m.addLayer(
        {
          id: "3d-buildings",
          source: buildingSource,
          "source-layer": "building",
          filter: ["has", "height"],
          type: "fill-extrusion",
          minzoom: 14,
          paint: {
            "fill-extrusion-color": "#aaa",
            "fill-extrusion-height": [
              "coalesce",
              ["get", "height"],
              ["get", "render_height"],
              5,
            ],
            "fill-extrusion-base": [
              "coalesce",
              ["get", "min_height"],
              ["get", "render_min_height"],
              0,
            ],
            "fill-extrusion-opacity": 0.5,
          },
        },
        labelLayerId,
      );
    };

    const m = map.getMap();
    // Retry setup: style may already be loaded or may load shortly
    if (m.isStyleLoaded()) setup();
    m.on("style.load", setup);
    // Also listen for styledata which fires more reliably with react-map-gl
    m.on("styledata", setup);
    return () => {
      m.off("style.load", setup);
      m.off("styledata", setup);
    };
  }, [map, mapStyle]);

  // Toggle pitch/rotation when is3D changes
  useEffect(() => {
    if (!map) return;
    const m = map.getMap();

    if (is3D) {
      m.setMaxPitch(85);
      m.dragRotate.enable();
      m.easeTo({ pitch: 45, duration: 500 });
    } else {
      m.easeTo({ pitch: 0, duration: 500 });
      // Set maxPitch after animation to avoid clamping during easeTo
      setTimeout(() => {
        m.setMaxPitch(0);
        m.dragRotate.disable();
      }, 600);
    }
  }, [map, is3D]);

  return null;
}

/**
 * Mapbox's default Shift+drag "box zoom" interaction claims the Shift
 * modifier at mousedown, which also swallows the plain Shift+click we use
 * to accumulate building fragments for merging — disable it so Shift is
 * free for that instead.
 */
function DisableBoxZoom() {
  const { current: map } = useMap();

  useEffect(() => {
    if (!map) return;
    map.getMap().boxZoom.disable();
  }, [map]);

  return null;
}

/**
 * Occasionally the map's raster/terrain tiles fail to load and never
 * recover on their own — vector layers (roads, labels) still render since
 * they come from a different source, leaving a mostly-blank map that looks
 * stuck. There's no reliable way to detect this in advance, so this just
 * reports it up (see MapView's recovery button) once Mapbox itself fires a
 * tile/source error — mirrors MapLoadNotifier's up-callback pattern since
 * useMap() only works for actual children of <Map>.
 */
function MapErrorWatcher({ onTileError }: { onTileError: () => void }) {
  const { current: map } = useMap();

  useEffect(() => {
    if (!map) return;
    const m = map.getMap();

    const handleError = (e: { error?: Error }) => {
      const message = e.error?.message ?? "";
      if (/tile|source|network|fetch/i.test(message)) {
        onTileError();
      }
    };

    m.on("error", handleError);
    return () => {
      m.off("error", handleError);
    };
  }, [map, onTileError]);

  return null;
}

/** Adds a geocoding search box to the map (top-left). */
function GeocoderControl() {
  const { current: map } = useMap();
  const mapboxToken = useConfigStore((s) => s.mapboxToken);
  const geocoderRef = useRef<MapboxGeocoder | null>(null);

  useEffect(() => {
    if (!map || !mapboxToken || geocoderRef.current) return;
    const m = map.getMap();

    const geocoder = new MapboxGeocoder({
      accessToken: mapboxToken,
      mapboxgl: mapboxgl as any,
      marker: false,
      collapsed: true,
      placeholder: "Hledat místo...",
    });

    m.addControl(geocoder, "top-left");
    geocoderRef.current = geocoder;

    return () => {
      try {
        m.removeControl(geocoder);
      } catch {
        // DOM already detached — ignore
      }
      geocoderRef.current = null;
    };
  }, [map, mapboxToken]);

  return null;
}

/**
 * Adds Mapbox's native "go to my location" control (bottom-right, out of
 * the way of the toolbar and the geocoder). `trackUserLocation` keeps a
 * small live dot on the map as the pilot moves, so they don't have to
 * search an address just to find themselves on site.
 */
function GeolocateControl() {
  const { current: map } = useMap();
  const controlRef = useRef<mapboxgl.GeolocateControl | null>(null);

  useEffect(() => {
    if (!map || controlRef.current) return;
    const m = map.getMap();

    const control = new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true,
    });

    m.addControl(control, "bottom-right");
    controlRef.current = control;

    return () => {
      try {
        m.removeControl(control);
      } catch {
        // DOM already detached — ignore
      }
      controlRef.current = null;
    };
  }, [map]);

  return null;
}

/**
 * Pans/zooms the map to `flyToTarget` whenever it's set (e.g. by a
 * LocationSearch box in the sidebar), then clears it so the same location
 * can be flown to again later.
 */
function FlyToTargetHandler() {
  const { current: map } = useMap();
  const flyToTarget = useMissionStore((s) => s.flyToTarget);
  const setFlyToTarget = useMissionStore((s) => s.setFlyToTarget);

  useEffect(() => {
    if (!map || !flyToTarget) return;
    const [lat, lng] = flyToTarget;
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 800,
    });
    setFlyToTarget(null);
  }, [map, flyToTarget, setFlyToTarget]);

  return null;
}

/**
 * Automatically fits the map to show all waypoints when a mission is loaded.
 * Triggers when waypoints go from 0 to N (N >= 2).
 */
/**
 * Hands the raw mapboxgl.Map instance up to the caller once it's ready —
 * used for capturing a PDF-report snapshot of the current view (see
 * lib/pdfSnapshot.ts), which needs direct canvas access that react-map-gl
 * doesn't otherwise expose to a parent component.
 */
function MapLoadNotifier({
  onMapLoad,
}: {
  onMapLoad?: (map: mapboxgl.Map) => void;
}) {
  const { current: map } = useMap();
  useEffect(() => {
    if (map && onMapLoad) onMapLoad(map.getMap());
  }, [map, onMapLoad]);
  return null;
}

function FitBoundsOnLoad() {
  const { current: map } = useMap();
  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);
  const obstacles = useMissionStore((s) => s.obstacles);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const wasEmpty = prevCountRef.current === 0;
    prevCountRef.current = waypoints.length;
    if (!wasEmpty || waypoints.length < 2 || !map) return;

    const allPoints = [
      ...waypoints.map((wp) => [wp.longitude, wp.latitude] as [number, number]),
      ...pois.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...obstacles.flatMap((o) =>
        o.vertices.map((v) => [v[1], v[0]] as [number, number]),
      ),
    ];

    if (allPoints.length === 0) return;

    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const [lng, lat] of allPoints) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ] as LngLatBoundsLike,
      { padding: 50, maxZoom: 16 },
    );
  }, [waypoints, pois, obstacles, map]);

  return null;
}

/** GeoJSON source + layer for the flight path polyline segments (3D with altitude) */
function FlightPath({ is3D }: { is3D: boolean }) {
  const waypoints = useMissionStore((s) => s.waypoints);
  const obstacles = useMissionStore((s) => s.obstacles);
  const config = useMissionStore((s) => s.config);
  const routeColorMode = usePreferencesStore(
    (s) => s.preferences?.visualization?.routeColorMode ?? "flat",
  );

  const warnings = useMemo(
    () => getObstacleWarnings(waypoints, obstacles),
    [waypoints, obstacles],
  );

  const warningSegments = useMemo(() => {
    const set = new Set<number>();
    for (const w of warnings) {
      if (w.type === "crosses") set.add(w.waypointIndex);
    }
    return set;
  }, [warnings]);

  // Effective cruise speed for a waypoint's departing segment — same
  // fallback lib/flightStats.ts's estimator uses (own speed when set,
  // otherwise the mission's global speed).
  const effectiveSpeed = useCallback(
    (wp: (typeof waypoints)[number]) =>
      wp.useGlobalSpeed ? config.autoFlightSpeed : wp.speed,
    [config.autoFlightSpeed],
  );

  // Per-segment value range for the active color mode — segment color is
  // normalized against the *whole mission's* min/max, not just the two
  // endpoints, so the gradient is consistent across every segment.
  const valueRange = useMemo(() => {
    if (routeColorMode === "flat" || waypoints.length < 2) return null;
    const values =
      routeColorMode === "height"
        ? waypoints.map((wp) => wp.height)
        : waypoints.slice(0, -1).map((wp) => effectiveSpeed(wp));
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [routeColorMode, waypoints, effectiveSpeed]);

  // 3D flight path segments (elevated)
  const geojson = useMemo(() => {
    if (waypoints.length < 2) return null;
    const features = waypoints.slice(0, -1).map((wp, i) => {
      const next = waypoints[i + 1];
      let color = "#00c2ff";
      if (valueRange) {
        const value =
          routeColorMode === "height"
            ? (wp.height + next.height) / 2
            : effectiveSpeed(wp);
        color = valueToGradientColor(value, valueRange.min, valueRange.max);
      }
      // Obstacle warnings are a safety signal, not a style choice — always
      // shown regardless of the active color mode.
      if (warningSegments.has(wp.index)) color = "#ef4444";
      return {
        type: "Feature" as const,
        properties: {
          color,
          zStart: wp.height,
          zEnd: next.height,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [wp.longitude, wp.latitude],
            [next.longitude, next.latitude],
          ],
        },
      };
    });
    return { type: "FeatureCollection" as const, features };
  }, [waypoints, warningSegments, routeColorMode, valueRange, effectiveSpeed]);

  // Vertical dashed lines from ground to waypoint height
  // Use a tiny offset so the line has non-zero length (required for line-progress)
  const polesGeojson = useMemo(() => {
    if (waypoints.length === 0) return null;
    const features = waypoints.map((wp) => ({
      type: "Feature" as const,
      properties: { height: wp.height },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [wp.longitude, wp.latitude],
          [wp.longitude + 1e-8, wp.latitude + 1e-8],
        ],
      },
    }));
    return { type: "FeatureCollection" as const, features };
  }, [waypoints]);

  // Ground shadow path (single continuous line at ground level)
  const groundPathGeojson = useMemo(() => {
    if (waypoints.length < 2) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: waypoints.map((wp) => [wp.longitude, wp.latitude]),
      },
    };
  }, [waypoints]);

  if (!geojson) return null;

  return (
    <>
      {/* Ground shadow line (3D only) */}
      {is3D && groundPathGeojson && (
        <Source id="flight-path-ground" type="geojson" data={groundPathGeojson}>
          <Layer
            id="flight-path-ground-line"
            type="line"
            paint={{
              "line-color": "#94a3b8",
              "line-width": 1.5,
              "line-opacity": 0.3,
            }}
            layout={{
              "line-cap": "round",
              "line-join": "round",
            }}
          />
        </Source>
      )}

      {/* Flight path lines — elevated in 3D, flat in 2D */}
      <Source id="flight-path" type="geojson" data={geojson} lineMetrics={true}>
        <Layer
          id="flight-path-line"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-width": 3,
            "line-opacity": 0.9,
            "line-dasharray": [2, 1.2],
          }}
          layout={
            is3D
              ? ({
                  "line-cap": "round",
                  "line-join": "round",
                  "line-z-offset": [
                    "interpolate",
                    ["linear"],
                    ["line-progress"],
                    0,
                    ["get", "zStart"],
                    1,
                    ["get", "zEnd"],
                  ],
                } as any)
              : {
                  "line-cap": "round",
                  "line-join": "round",
                }
          }
        />
      </Source>

      {/* Vertical dashed lines from ground to waypoint altitude (3D only) */}
      {is3D && polesGeojson && (
        <Source
          id="wp-poles"
          type="geojson"
          data={polesGeojson}
          lineMetrics={true}
        >
          <Layer
            id="wp-poles-layer"
            type="line"
            paint={{
              "line-color": "#94a3b8",
              "line-width": 1,
              "line-opacity": 0.5,
              "line-dasharray": [2, 2],
            }}
            layout={
              {
                "line-z-offset": [
                  "interpolate",
                  ["linear"],
                  ["line-progress"],
                  0,
                  0,
                  1,
                  ["get", "height"],
                ],
              } as any
            }
          />
        </Source>
      )}
    </>
  );
}

/** Dotted lines from waypoints to their referenced POI */
function PoiPointingLines({ is3D }: { is3D: boolean }) {
  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);

  const geojson = useMemo(() => {
    const features: any[] = [];
    for (const wp of waypoints) {
      if (wp.headingMode === "towardPOI" && wp.poiId) {
        const poi = pois.find((p) => p.id === wp.poiId);
        if (poi) {
          features.push({
            type: "Feature",
            properties: {
              color: "#4ade80",
              width: 3,
              opacity: 0.8,
              zStart: wp.height,
              zEnd: poi.height,
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [wp.longitude, wp.latitude],
                [poi.longitude, poi.latitude],
              ],
            },
          });
        }
      }
    }
    return { type: "FeatureCollection" as const, features };
  }, [waypoints, pois]);

  if (geojson.features.length === 0) return null;

  return (
    <Source id="poi-pointing-lines" type="geojson" data={geojson} lineMetrics>
      <Layer
        id="poi-pointing-lines-layer"
        type="line"
        paint={{
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": ["get", "opacity"],
        }}
        layout={
          is3D
            ? ({
                "line-z-offset": [
                  "interpolate",
                  ["linear"],
                  ["line-progress"],
                  0,
                  ["get", "zStart"],
                  1,
                  ["get", "zEnd"],
                ],
              } as any)
            : {}
        }
      />
    </Source>
  );
}

interface MapViewProps {
  /** Called once the underlying mapboxgl.Map is ready — see MapLoadNotifier. */
  onMapLoad?: (map: mapboxgl.Map) => void;
}

export function MapView({ onMapLoad }: MapViewProps = {}) {
  const mapboxToken = useConfigStore((s) => s.mapboxToken);
  const defaultMapView = useConfigStore((s) => s.defaultMapView);
  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);
  const obstacles = useMissionStore((s) => s.obstacles);
  const buildings = useMissionStore((s) => s.buildings);
  const isAddingWaypoint = useMissionStore((s) => s.isAddingWaypoint);
  const isAddingPoi = useMissionStore((s) => s.isAddingPoi);
  const isDrawingObstacle = useMissionStore((s) => s.isDrawingObstacle);
  const isDrawingBuilding = useMissionStore((s) => s.isDrawingBuilding);
  const templateMode = useMissionStore((s) => s.templateMode);
  const selectedWaypointIndices = useMissionStore(
    (s) => s.selectedWaypointIndices,
  );
  const addWaypoint = useMissionStore((s) => s.addWaypoint);
  const addPoi = useMissionStore((s) => s.addPoi);
  const addObstacle = useMissionStore((s) => s.addObstacle);
  const addBuilding = useMissionStore((s) => s.addBuilding);
  const simulationActive = useFlightSimulationStore((s) => s.isActive);
  const simulationFrameIndex = useFlightSimulationStore((s) => s.frameIndex);
  const simulationFrames = useMemo(
    () =>
      simulationActive
        ? buildSimulationFrames(waypoints, pois, FRAMES_PER_SEGMENT)
        : [],
    [simulationActive, waypoints, pois],
  );
  const simulationFrame = simulationActive
    ? simulationFrames[
        Math.min(simulationFrameIndex, simulationFrames.length - 1)
      ]
    : undefined;
  const vizPrefs = usePreferencesStore((s) => s.preferences?.visualization);
  const [mapStyle, setMapStyle] = useState(
    vizPrefs?.mapStyle === "street"
      ? "mapbox://styles/mapbox/dark-v11"
      : "mapbox://styles/mapbox/satellite-streets-v12",
  );
  const [is3D, setIs3D] = useState(vizPrefs?.viewMode === "3d");
  const [buildingPopup, setBuildingPopup] = useState<BuildingPopupData | null>(
    null,
  );
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const [mapStuck, setMapStuck] = useState(false);
  const handleTileError = useCallback(() => setMapStuck(true), []);

  const cursorClass =
    templateMode === "pencil" || templateMode === "corridor"
      ? "map-tool-pencil"
      : templateMode
        ? "map-tool-template"
        : isDrawingObstacle || isDrawingBuilding
          ? "map-tool-obstacle"
          : isAddingWaypoint
            ? "map-tool-waypoint"
            : isAddingPoi
              ? "map-tool-poi"
              : "";

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      if (templateMode || isDrawingObstacle || isDrawingBuilding) return;
      if (isAddingWaypoint) {
        addWaypoint(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      if (isAddingPoi) {
        addPoi(e.lngLat.lat, e.lngLat.lng);
        return;
      }

      // Shift-click accumulates adjacent building fragments into the
      // current selection (for merging several OSM footprints that make
      // up one real building) instead of replacing it.
      const isMultiSelect = e.originalEvent?.shiftKey === true;

      // Check if a 3D building was clicked
      const map = e.target as any;
      if (map.getLayer && map.getLayer("3d-buildings")) {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["3d-buildings"],
        });
        if (features && features.length > 0) {
          const feature = features[0];
          const geometry = feature.geometry;
          if (geometry.type === "Polygon" && geometry.coordinates?.[0]) {
            // Convert [lng, lat] → [lat, lng] for our obstacle format
            const ring = geometry.coordinates[0] as [number, number][];
            // Remove the closing duplicate vertex
            const vertices: [number, number][] = ring
              .slice(0, -1)
              .map(([lng, lat]) => [lat, lng] as [number, number]);

            if (vertices.length >= 3) {
              const height = feature.properties?.height ?? null;
              const fragment: BuildingFragment = {
                height: height ? Math.round(height) : null,
                vertices,
              };
              const fragmentKey = JSON.stringify(fragment.vertices);

              setBuildingPopup((prev) => {
                if (isMultiSelect && prev) {
                  const alreadySelected = prev.fragments.some(
                    (f) => JSON.stringify(f.vertices) === fragmentKey,
                  );
                  if (alreadySelected) return prev;
                  return {
                    lng: e.lngLat.lng,
                    lat: e.lngLat.lat,
                    fragments: [...prev.fragments, fragment],
                  };
                }
                return {
                  lng: e.lngLat.lng,
                  lat: e.lngLat.lat,
                  fragments: [fragment],
                };
              });
              return;
            }
          }
        }
      }

      // Shift-clicked empty space while fragments were already selected —
      // keep the selection instead of dismissing it.
      if (isMultiSelect) return;

      // Clicked elsewhere — dismiss popup
      setBuildingPopup(null);
    },
    [
      isAddingWaypoint,
      isAddingPoi,
      templateMode,
      isDrawingObstacle,
      isDrawingBuilding,
      addWaypoint,
      addPoi,
    ],
  );

  const isMeasuring = useMeasureStore((s) => s.isActive);
  const cursor =
    templateMode ||
    isDrawingObstacle ||
    isDrawingBuilding ||
    isAddingWaypoint ||
    isAddingPoi ||
    isMeasuring
      ? "crosshair"
      : "grab";

  if (!mapboxToken) {
    return (
      <div className="relative h-full w-full flex items-center justify-center bg-background text-muted-foreground">
        <p>Mapbox token not configured. Add MAPBOX_TOKEN to your .env file.</p>
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full ${cursorClass}`}>
      <Map
        mapboxAccessToken={mapboxToken}
        initialViewState={{
          longitude: defaultMapView.longitude,
          latitude: defaultMapView.latitude,
          zoom: defaultMapView.zoom,
          pitch: 0,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        cursor={cursor}
        onClick={handleClick}
        doubleClickZoom={false}
        id="main-map"
        // Terrain stays "set" (never undefined) even in 2D mode, with
        // exaggeration 0 so it renders perfectly flat — this is what lets
        // `map.queryTerrainElevation()` return real ground elevation
        // regardless of view mode, for the elevation graph's terrain
        // profile and the terrain-collision check (see lib/terrain.ts).
        terrain={{ source: "mapbox-dem", exaggeration: is3D ? 1 : 0 }}
        // Required for lib/pdfSnapshot.ts's canvas.toDataURL() capture --
        // without it the WebGL buffer is cleared right after each paint and
        // the snapshot comes back blank.
        preserveDrawingBuffer={true}
      >
        <MapLoadNotifier
          onMapLoad={(m) => {
            mapInstanceRef.current = m;
            onMapLoad?.(m);
          }}
        />
        <MapErrorWatcher onTileError={handleTileError} />
        {/* DEM source — always present so terrain prop can reference it */}
        <Source
          id="mapbox-dem"
          type="raster-dem"
          url="mapbox://mapbox.mapbox-terrain-dem-v1"
          tileSize={512}
          maxzoom={14}
        />
        <FitBoundsOnLoad />
        <DisableBoxZoom />
        <GeocoderControl />
        <GeolocateControl />
        <FlyToTargetHandler />
        <SceneSetup is3D={is3D} mapStyle={mapStyle} />
        <FlightPath is3D={is3D} />
        <PoiPointingLines is3D={is3D} />
        <TemplateDrawHandler />
        <PencilDrawHandler />
        <SolarDrawHandler />
        <CorridorDrawHandler />
        <TurbineDrawHandler />
        <ObstacleDrawHandler />
        <BuildingDrawHandler />
        <MeasureToolHandler />
        <CustomLayersOverlay />
        <AirspaceOverlay />
        <FlightTrackOverlay />
        {obstacles.map((obstacle) => (
          <ObstaclePolygon key={obstacle.id} obstacle={obstacle} />
        ))}
        {buildings.map((building) => (
          <BuildingPolygon key={building.id} building={building} is3D={is3D} />
        ))}
        {waypoints.map((wp) => (
          <WaypointMarker key={wp.index} waypoint={wp} is3D={is3D} />
        ))}
        {simulationFrame ? (
          <>
            <CameraFrustum
              waypoint={frameToWaypoint(simulationFrame)}
              pois={pois}
              is3D={is3D}
            />
            <Source
              id="flight-simulation-drone"
              type="geojson"
              data={{
                type: "Feature",
                properties: {},
                geometry: {
                  type: "Point",
                  coordinates: [
                    simulationFrame.longitude,
                    simulationFrame.latitude,
                  ],
                },
              }}
            >
              <Layer
                id="flight-simulation-drone-layer"
                type="circle"
                paint={{
                  "circle-radius": 6,
                  "circle-color": "#00c2ff",
                  "circle-stroke-width": 2,
                  "circle-stroke-color": "#ffffff",
                }}
              />
            </Source>
          </>
        ) : (
          selectedWaypointIndices.size === 1 &&
          (() => {
            const idx = [...selectedWaypointIndices][0];
            const wp = waypoints.find((w) => w.index === idx);
            return wp ? (
              <CameraFrustum waypoint={wp} pois={pois} is3D={is3D} />
            ) : null;
          })()
        )}
        {pois.map((poi) => (
          <PoiMarker key={poi.id} poi={poi} is3D={is3D} />
        ))}

        <DjiTelemetryMarkers />

        {/* Building-to-obstacle / building-to-Budova popup. Shift-click
            accumulates several adjacent OSM fragments (a large complex is
            often split into many footprints) so they can be merged into
            one Budova instead of converting each fragment separately. */}
        {buildingPopup &&
          (() => {
            const { fragments } = buildingPopup;
            const isMulti = fragments.length > 1;
            const single = fragments[0];
            const totalVertices = fragments.reduce(
              (sum, f) => sum + f.vertices.length,
              0,
            );

            return (
              <Popup
                longitude={buildingPopup.lng}
                latitude={buildingPopup.lat}
                anchor="bottom"
                closeOnClick={false}
                onClose={() => setBuildingPopup(null)}
                className="building-popup"
              >
                <div className="flex flex-col gap-2 p-1 min-w-[160px]">
                  <div className="text-xs text-zinc-300">
                    <strong className="text-white">
                      {isMulti
                        ? `${fragments.length} vybrané budovy`
                        : "Budova"}
                    </strong>
                    {!isMulti && single.height != null && (
                      <span className="ml-2 text-zinc-400">
                        výška {single.height}m
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {isMulti
                      ? `${totalVertices} vrcholů celkem — Shift+klik přidá další sousední fragment`
                      : `${single.vertices.length} ${
                          single.vertices.length === 1
                            ? "vrchol"
                            : single.vertices.length >= 2 &&
                                single.vertices.length <= 4
                              ? "vrcholy"
                              : "vrcholů"
                        }`}
                  </div>
                  {isMulti ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5 h-7 text-xs"
                        onClick={() => {
                          const merged = mergeBuildingFootprints(fragments);
                          addBuilding(merged.vertices, merged.height);
                          setBuildingPopup(null);
                        }}
                      >
                        <Building2 className="h-3 w-3" />
                        Sloučit a převést na budovu
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-full h-7 text-xs text-zinc-400"
                        onClick={() => setBuildingPopup(null)}
                      >
                        Zrušit výběr
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5 h-7 text-xs"
                        onClick={() => {
                          // 20m matches BuildingDrawHandler's own default
                          // for a manually-drawn building with no set
                          // height yet.
                          addBuilding(single.vertices, single.height ?? 20);
                          setBuildingPopup(null);
                        }}
                      >
                        <Building2 className="h-3 w-3" />
                        Převést na budovu
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5 h-7 text-xs"
                        onClick={() => {
                          addObstacle(single.vertices);
                          setBuildingPopup(null);
                        }}
                      >
                        <Triangle className="h-3 w-3" />
                        Převést na překážku
                      </Button>
                    </>
                  )}
                </div>
              </Popup>
            );
          })()}
      </Map>

      {mapStuck && (
        <button
          className="absolute top-14 left-1/2 -translate-x-1/2 z-20 rounded bg-amber-900/90 border border-amber-500/50 px-3 py-1.5 text-xs text-amber-100 backdrop-blur-sm shadow-lg"
          onClick={() => {
            const m = mapInstanceRef.current;
            const style = m?.getStyle();
            if (m && style) {
              m.setStyle(style, {
                diff: false,
                localFontFamily: undefined,
                localIdeographFontFamily: undefined,
              });
            }
            setMapStuck(false);
          }}
        >
          Mapa se možná nenačetla správně — Obnovit
        </button>
      )}

      {/* Style switcher + 2D/3D toggle */}
      <div className="absolute bottom-4 left-4 z-10 flex gap-1">
        <button
          className={`px-2 py-1 text-xs rounded ${mapStyle.includes("dark") ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground border border-border"}`}
          onClick={() => setMapStyle("mapbox://styles/mapbox/dark-v11")}
        >
          Mapa ulic
        </button>
        <button
          className={`px-2 py-1 text-xs rounded ${mapStyle.includes("satellite") ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground border border-border"}`}
          onClick={() =>
            setMapStyle("mapbox://styles/mapbox/satellite-streets-v12")
          }
        >
          Satelitní
        </button>
        <div className="w-px bg-border mx-1" />
        <button
          className={`px-2 py-1 text-xs rounded ${!is3D ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground border border-border"}`}
          onClick={() => setIs3D(false)}
        >
          2D
        </button>
        <button
          className={`px-2 py-1 text-xs rounded ${is3D ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground border border-border"}`}
          onClick={() => setIs3D(true)}
        >
          3D
        </button>
      </div>

      <MapToolbar />
    </div>
  );
}
