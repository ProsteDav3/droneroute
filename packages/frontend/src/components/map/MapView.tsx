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
import { NewMissionDroneDialog } from "../mission/NewMissionDroneDialog";
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
  interpolateHeading,
  findFrameBracket,
  FRAMES_PER_SEGMENT,
  type SimulationFrame,
} from "@/lib/flightSimulation";
import {
  queryElevationProfileWithRetry,
  fillMissingElevations,
} from "@/lib/terrain";
import { WIDE_CAMERA_FOV } from "@/lib/solarCamera";
import { DEFAULT_WIDE_VFOV_DEG } from "@/lib/templates";
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
function SceneSetup({
  is3D,
  mapStyle,
  flythroughActive,
}: {
  is3D: boolean;
  mapStyle: string;
  flythroughActive: boolean;
}) {
  const { current: map } = useMap();
  // Read fresh inside `setup` (which only depends on [map, mapStyle], so it
  // doesn't restart every time flythroughActive flips) so a layer created
  // while a flythrough is already underway starts hidden immediately
  // instead of flashing visible until the separate toggle effect below
  // happens to run again.
  const flythroughActiveRef = useRef(flythroughActive);
  flythroughActiveRef.current = flythroughActive;

  // Buildings layer (re-added on style changes)
  useEffect(() => {
    if (!map) return;

    const setup = () => {
      const m = map.getMap();
      if (!m.isStyleLoaded()) return;
      if (m.getLayer("3d-buildings")) return;

      // Always use a dedicated vector source for the building data instead
      // of trying to detect whether the style's own "composite" source
      // happens to include it. That detection was a URL substring guess
      // (`compositeSource.url.includes("mapbox.mapbox-streets")`), and
      // guessing wrong meant addLayer below threw synchronously — Mapbox
      // validates a source-layer against an already-loaded source
      // eagerly, so a bad guess against "composite" (loaded as part of
      // the base style) failed immediately, the layer never got added,
      // and getLayer("3d-buildings") above meant every later retry
      // short-circuited before trying again. mapbox-streets-v8 always has
      // a "building" source-layer, so there's nothing left to guess.
      if (!m.getSource("mapbox-streets")) {
        m.addSource("mapbox-streets", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-streets-v8",
        });
      }

      const style = m.getStyle();
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

      try {
        m.addLayer(
          {
            id: "3d-buildings",
            source: "mapbox-streets",
            "source-layer": "building",
            filter: ["has", "height"],
            type: "fill-extrusion",
            minzoom: 14,
            layout: {
              visibility: flythroughActiveRef.current ? "none" : "visible",
            },
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
      } catch (err) {
        // A freshly-added source can occasionally not be ready yet on the
        // very first styledata tick — the next styledata/style.load event
        // retries (getLayer guard above only skips once it actually
        // exists), so this is a log for visibility, not a dead end.
        console.error("Failed to add 3d-buildings layer, will retry", err);
      }
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

  // Hides the citywide OSM 3D-buildings layer for the duration of a
  // flythrough. It can easily be the single heaviest thing on screen in a
  // dense area (hundreds of extruded polygons the mission has nothing to
  // do with), and a real onboard camera obviously still shows real
  // buildings anyway — this only hides SkyRoute's own decorative citywide
  // extrusion, not the actual satellite/terrain imagery underneath, nor
  // any building the mission itself cares about (BuildingPolygon stays).
  useEffect(() => {
    if (!map) return;
    const m = map.getMap();
    if (!m.getLayer("3d-buildings")) return;
    m.setLayoutProperty(
      "3d-buildings",
      "visibility",
      flythroughActive ? "none" : "visible",
    );
  }, [map, flythroughActive]);

  return null;
}

/** Converts a DJI gimbal pitch (0° = horizon, -90° = straight down, the
 * convention used everywhere else in this app) to a Mapbox FreeCameraOptions
 * pitch (0° = straight down, 90° = horizon) — the two scales run opposite
 * directions from the same zero point. */
function gimbalPitchToMapboxPitch(gimbalPitchDeg: number): number {
  return Math.max(0, Math.min(180, 90 + gimbalPitchDeg));
}

/** Mapbox GL's own `Transform.fov` setter silently clamps to this — set here
 * explicitly rather than relying on that undocumented internal behavior. */
const MAPBOX_MAX_FOV_DEG = 60;

/** Linearly interpolates between two adjacent simulation frames — since
 * every frame in `buildSimulationFrames`' own 24-per-leg output is already
 * itself a linear sample along a straight waypoint-to-waypoint leg,
 * blending two adjacent ones is exactly equivalent to sampling the route at
 * a finer resolution, not an approximation. */
function lerpFrame(
  a: SimulationFrame,
  b: SimulationFrame,
  t: number,
): {
  lat: number;
  lng: number;
  height: number;
  heading: number;
  gimbalPitch: number;
} {
  return {
    lat: a.latitude + (b.latitude - a.latitude) * t,
    lng: a.longitude + (b.longitude - a.longitude) * t,
    height: a.height + (b.height - a.height) * t,
    heading: interpolateHeading(a.headingAngle, b.headingAngle, t),
    gimbalPitch:
      a.gimbalPitchAngle + (b.gimbalPitchAngle - a.gimbalPitchAngle) * t,
  };
}

/**
 * Drives the map's camera to a true first-person view from the drone itself
 * during a flight simulation when "3D flythrough" is selected — camera
 * position is the drone's actual lat/lng/altitude (via Mapbox's
 * FreeCameraOptions, the same API Mapbox's own drone-camera examples use),
 * oriented by the drone's heading and gimbal pitch, instead of the default
 * fixed overhead view with just a moving dot.
 *
 * Runs its own real-time clock rather than snapping to whatever position the
 * store's `playheadS` happens to be at: `FlightSimulationPanel`'s own rAF
 * loop only advances that a handful of times a second, and both teleporting
 * the camera to each new value *and* easing/smoothing toward it are wrong —
 * the former is visibly choppy, the latter makes the camera lag behind
 * where the drone actually is. Instead, every real animation frame (~60fps)
 * this recomputes the *exact* fractional position along the route for
 * however many simulated flight-seconds have elapsed since playback last
 * started/resumed/was scrubbed, by interpolating between the two bracketing
 * frames — always exactly on the route, never behind it, and updated far
 * more often than the store ticks for smooth motion. `speed` is a
 * real-time multiplier (1x plays back exactly as fast as the drone would
 * actually fly the mission), not an arbitrary frame rate.
 *
 * Forces the map into 3D for the duration — pitch is clamped to 0 in 2D
 * mode, per SceneSetup above — and restores the original camera view and
 * 2D/3D state once the flythrough ends.
 */
function FlightSimulationCamera({
  is3D,
  setIs3D,
}: {
  is3D: boolean;
  setIs3D: (value: boolean) => void;
}) {
  const { current: map } = useMap();
  const simulationActive = useFlightSimulationStore((s) => s.isActive);
  const cameraMode = useFlightSimulationStore((s) => s.cameraMode);
  const isPlaying = useFlightSimulationStore((s) => s.isPlaying);
  const speed = useFlightSimulationStore((s) => s.speed);
  const playheadS = useFlightSimulationStore((s) => s.playheadS);
  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);
  const autoFlightSpeed = useMissionStore((s) => s.config.autoFlightSpeed);
  const payloadEnumValue = useMissionStore((s) => s.config.payloadEnumValue);

  const flying = simulationActive && cameraMode === "flythrough";

  const frames = useMemo(
    () =>
      flying
        ? buildSimulationFrames(
            waypoints,
            pois,
            FRAMES_PER_SEGMENT,
            autoFlightSpeed,
          )
        : [],
    [flying, waypoints, pois, autoFlightSpeed],
  );

  const originalViewRef = useRef<{
    center: mapboxgl.LngLat;
    zoom: number;
    bearing: number;
    pitch: number;
    fov: number;
  } | null>(null);
  const wasIs3DRef = useRef(is3D);

  // Enter/exit: capture (or restore) the view the pilot had before starting
  // the flythrough, force 3D on for its duration, and match the map's own
  // rendering field of view to whatever vertical FOV the mission's gimbal
  // math (Orbit's whole-object framing, see lib/templates.ts) assumed —
  // Mapbox GL's default camera FOV is a fixed ~36.87°, much narrower than a
  // real drone's wide lens (typically 55-63°). Left unset, every framing
  // angle computed assuming the wider lens renders through a visibly
  // narrower one instead — cropping exactly the top/bottom margin the
  // framing math was counting on, independent of whether the angle itself
  // was computed correctly.
  useEffect(() => {
    if (!map) return;
    const m = map.getMap();

    if (flying && !originalViewRef.current) {
      wasIs3DRef.current = is3D;
      originalViewRef.current = {
        center: m.getCenter(),
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        pitch: m.getPitch(),
        fov: m.transform.fov,
      };
      const missionVfovDeg =
        WIDE_CAMERA_FOV[payloadEnumValue]?.vfovDeg ?? DEFAULT_WIDE_VFOV_DEG;
      m.transform.fov = Math.min(MAPBOX_MAX_FOV_DEG, missionVfovDeg);
      if (!is3D) setIs3D(true);
    } else if (!flying && originalViewRef.current) {
      const original = originalViewRef.current;
      originalViewRef.current = null;
      if (!wasIs3DRef.current) setIs3D(false);
      m.transform.fov = original.fov;
      // Calling easeTo (or any standard camera method) after
      // setFreeCameraOptions hands control back to the normal camera model.
      m.easeTo({ ...original, duration: 500 });
    }
    // is3D/setIs3D/payloadEnumValue deliberately excluded: this effect only
    // cares about the flying transition, not about is3D changes for other
    // reasons (e.g. the pilot manually toggling 2D/3D mid-flythrough), and a
    // drone changed mid-flythrough shouldn't retarget the FOV until the next
    // flythrough starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flying, map]);

  // Ground elevation under every frame, queried once per frame set rather
  // than on every animation tick. FreeCameraOptions wants true altitude
  // above sea level, unlike the waypoint markers' own `altitude` prop
  // (which Mapbox already treats as height-above-terrain for us) — without
  // adding ground elevation back in, the camera would sit underground
  // anywhere terrain sits above sea level.
  //
  // A flythrough forces 3D on right as it starts, which can be the very
  // first moment terrain exaggeration (and DEM tiles for this exact area)
  // become active — querying immediately then routinely got back nothing
  // (null) for every frame, which fillMissingElevations falls back to 0
  // for. A ground elevation of 0 anywhere above true sea level (which is
  // most places) put the camera underground, rendering as a smeared,
  // near-ground, seemingly "stuck at street level" view that also read as
  // choppy since the scene was mostly solid terrain a few centimeters from
  // the lens. Retrying gives the DEM tiles a moment to load first.
  //
  // A location the map hasn't rendered in 3D before this exact flythrough
  // (a mission just created at a fresh address, never previously orbited)
  // can need noticeably longer than a few retries — its DEM tiles have
  // never been fetched at all, not just not-yet-decoded, so the original
  // 10x300ms (3s) budget still routinely lost the race here specifically,
  // even though it was plenty for an area already panned/zoomed into
  // earlier in the same session. A longer, still-bounded budget costs
  // nothing but a slightly later flythrough start (the user sees the normal
  // map, not a broken one, while this resolves) and avoids the underground
  // view reappearing on exactly the missions where it's most likely: brand
  // new locations.
  const groundElevationsRef = useRef<number[]>([]);
  const [groundReady, setGroundReady] = useState(false);
  useEffect(() => {
    if (!flying || !map || frames.length === 0) {
      groundElevationsRef.current = [];
      setGroundReady(false);
      return;
    }
    let cancelled = false;
    setGroundReady(false);
    void queryElevationProfileWithRetry(
      map.getMap(),
      frames.map((f) => ({ lat: f.latitude, lng: f.longitude })),
      25,
      300,
    ).then((raw) => {
      if (cancelled) return;
      groundElevationsRef.current = fillMissingElevations(raw);
      setGroundReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [flying, map, frames]);

  // Anchors the continuous clock: a (real time, simulated flight-time) pair
  // captured whenever playback starts/resumes, or the pilot scrubs while
  // paused — everything after that is derived purely from elapsed real time,
  // never from the store's own coarser tick.
  const anchorRef = useRef({ wallStartMs: 0, playheadStartS: 0 });
  const wasPlayingRef = useRef(isPlaying);
  const lastPlayheadSRef = useRef(playheadS);
  useEffect(() => {
    const justStartedPlaying = isPlaying && !wasPlayingRef.current;
    const scrubbedWhilePaused =
      !isPlaying && playheadS !== lastPlayheadSRef.current;
    if (justStartedPlaying || scrubbedWhilePaused) {
      anchorRef.current = {
        wallStartMs: performance.now(),
        playheadStartS: playheadS,
      };
    }
    wasPlayingRef.current = isPlaying;
    lastPlayheadSRef.current = playheadS;
  }, [isPlaying, playheadS]);

  // isPlaying/speed/playheadS are read fresh inside the rAF loop via refs
  // rather than being effect dependencies — the loop below starts once when
  // flythrough begins and keeps running uninterrupted for its whole
  // duration; restarting it on every store tick (10-40x/sec) would
  // reintroduce the exact choppiness this whole design avoids.
  const isPlayingRef = useRef(isPlaying);
  const speedRef = useRef(speed);
  const playheadSRef = useRef(playheadS);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    speedRef.current = speed;
    playheadSRef.current = playheadS;
  }, [isPlaying, speed, playheadS]);

  const rafIdRef = useRef<number | null>(null);
  // Reused across every tick instead of `new FreeCameraOptions()` each
  // time — 60 allocations/sec of camera + coordinate objects is avoidable
  // GC pressure competing with the same frame budget the render itself
  // needs.
  const cameraRef = useRef(new mapboxgl.FreeCameraOptions());
  // Written directly via textContent inside the tick loop rather than
  // through React state — this element updates ~60x/sec, and routing that
  // through setState/re-render would fight the same frame budget the
  // camera update itself needs. Temporary diagnostic surface for tracking
  // down a persistent "camera renders near the ground" bug that's survived
  // multiple blind fixes (terrain-elevation timing, retry budget) without
  // a way to see the actual computed numbers at the moment it happens.
  const debugRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    // Waits for groundReady so the very first rendered frame already has
    // real ground elevation — starting immediately with the zeroed
    // fallback (then correcting a moment later) is exactly the "camera
    // briefly underground" glitch this whole effect exists to avoid.
    if (!flying || !map || frames.length === 0 || !groundReady) return;
    const m = map.getMap();
    const camera = cameraRef.current;

    const tick = () => {
      const continuousS = isPlayingRef.current
        ? anchorRef.current.playheadStartS +
          ((performance.now() - anchorRef.current.wallStartMs) / 1000) *
            speedRef.current
        : playheadSRef.current;
      const { lower, upper, t } = findFrameBracket(frames, continuousS);
      const pos = lerpFrame(frames[lower], frames[upper], t);

      const groundLower = groundElevationsRef.current[lower] ?? 0;
      const groundUpper = groundElevationsRef.current[upper] ?? groundLower;
      const ground = groundLower + (groundUpper - groundLower) * t;
      const cameraAltitude = ground + pos.height;
      const mapboxPitch = gimbalPitchToMapboxPitch(pos.gimbalPitch);

      camera.position = mapboxgl.MercatorCoordinate.fromLngLat(
        { lng: pos.lng, lat: pos.lat },
        cameraAltitude,
      );
      camera.setPitchBearing(mapboxPitch, pos.heading);
      m.setFreeCameraOptions(camera);

      if (debugRef.current) {
        debugRef.current.textContent = [
          `t=${continuousS.toFixed(1)}s  leg ${lower}→${upper} (t=${t.toFixed(2)})`,
          `wp height=${pos.height.toFixed(1)}m  ground(msl)=${ground.toFixed(1)}m  camera alt(msl)=${cameraAltitude.toFixed(1)}m`,
          `gimbal(DJI)=${pos.gimbalPitch.toFixed(1)}°  mapbox pitch=${mapboxPitch.toFixed(1)}°  heading=${pos.heading.toFixed(1)}°`,
          `map fov=${m.transform.fov.toFixed(1)}°  groundLower=${groundLower.toFixed(1)}  groundUpper=${groundUpper.toFixed(1)}`,
          `lat=${pos.lat.toFixed(6)} lng=${pos.lng.toFixed(6)}`,
        ].join("\n");
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    };
  }, [flying, map, frames, groundReady]);

  if (!flying) return null;

  return (
    <pre
      ref={debugRef}
      className="absolute top-14 right-3 z-20 rounded bg-black/80 px-2 py-1.5 text-[10px] leading-tight text-emerald-300 font-mono whitespace-pre pointer-events-none"
    />
  );
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
      // By default GeolocateControl zooms out enough to fit the whole
      // accuracy-radius circle, which on a low-precision fix (no real GPS
      // hardware, network/IP-based positioning) can mean the entire city.
      // A pilot standing on site wants to see their immediate surroundings
      // regardless of how uncertain the fix is, so cap how far out it'll go.
      fitBoundsOptions: { maxZoom: 17 },
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
function FlightPath({
  is3D,
  flythroughActive,
}: {
  is3D: boolean;
  flythroughActive: boolean;
}) {
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
      {/* Ground shadow line (3D only) — skipped during the flythrough:
       * a real onboard camera wouldn't render a shadow of its own path, and
       * one less per-vertex line-z-offset expression to evaluate every
       * animation frame while flying. */}
      {is3D && !flythroughActive && groundPathGeojson && (
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

      {/* Vertical dashed lines from ground to waypoint altitude (3D only,
       * skipped during the flythrough for the same reason as the ground
       * shadow above). */}
      {is3D && !flythroughActive && polesGeojson && (
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
function PoiPointingLines({
  is3D,
  flythroughActive,
}: {
  is3D: boolean;
  flythroughActive: boolean;
}) {
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

  if (geojson.features.length === 0 || flythroughActive) return null;

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
  const pendingTemplateModeDroneGate = useMissionStore(
    (s) => s.pendingTemplateModeDroneGate,
  );
  const confirmTemplateModeDroneGate = useMissionStore(
    (s) => s.confirmTemplateModeDroneGate,
  );
  const cancelTemplateModeDroneGate = useMissionStore(
    (s) => s.cancelTemplateModeDroneGate,
  );
  const missionDefaults = usePreferencesStore(
    (s) => s.preferences.missionDefaults,
  );
  const selectedWaypointIndices = useMissionStore(
    (s) => s.selectedWaypointIndices,
  );
  const addWaypoint = useMissionStore((s) => s.addWaypoint);
  const addPoi = useMissionStore((s) => s.addPoi);
  const addObstacle = useMissionStore((s) => s.addObstacle);
  const addBuilding = useMissionStore((s) => s.addBuilding);
  const config = useMissionStore((s) => s.config);
  const simulationActive = useFlightSimulationStore((s) => s.isActive);
  const simulationCameraMode = useFlightSimulationStore((s) => s.cameraMode);
  const flythroughActive =
    simulationActive && simulationCameraMode === "flythrough";
  const simulationPlayheadS = useFlightSimulationStore((s) => s.playheadS);
  const simulationFrames = useMemo(
    () =>
      simulationActive
        ? buildSimulationFrames(
            waypoints,
            pois,
            FRAMES_PER_SEGMENT,
            config.autoFlightSpeed,
          )
        : [],
    [simulationActive, waypoints, pois, config.autoFlightSpeed],
  );
  const simulationFrame = simulationActive
    ? (() => {
        if (simulationFrames.length === 0) return undefined;
        // Nearest frame by time, rounding at the midpoint — "top" mode's
        // marker/frustum don't need the same sub-frame interpolation
        // precision the FPV camera does, so just picking the closer of the
        // two bracketing frames avoids needing to synthesize a full
        // SimulationFrame from a lerp result.
        const { lower, upper, t } = findFrameBracket(
          simulationFrames,
          simulationPlayheadS,
        );
        return simulationFrames[t < 0.5 ? lower : upper];
      })()
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
        <SceneSetup
          is3D={is3D}
          mapStyle={mapStyle}
          flythroughActive={flythroughActive}
        />
        <FlightSimulationCamera is3D={is3D} setIs3D={setIs3D} />
        <FlightPath is3D={is3D} flythroughActive={flythroughActive} />
        <PoiPointingLines is3D={is3D} flythroughActive={flythroughActive} />
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
        {/* Waypoint/POI markers, the camera frustum, and the "you are
         * here" drone dot are all planning UI for looking AT the route
         * from outside it — during a first-person flythrough the camera
         * itself already IS that viewpoint, so they'd just be redundant
         * clutter in frame. Hiding them also drops however many per-item
         * DOM markers the mission has from Mapbox's per-frame marker
         * repositioning work, which was adding up on top of everything
         * else competing for the same 60fps budget during playback. */}
        {!flythroughActive &&
          waypoints.map((wp) => (
            <WaypointMarker key={wp.index} waypoint={wp} is3D={is3D} />
          ))}
        {!flythroughActive &&
          (simulationFrame ? (
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
          ))}
        {!flythroughActive &&
          pois.map((poi) => <PoiMarker key={poi.id} poi={poi} is3D={is3D} />)}

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

      {pendingTemplateModeDroneGate && (
        <NewMissionDroneDialog
          defaultDroneKey={`${missionDefaults.droneEnumValue}-${missionDefaults.droneSubEnumValue}`}
          onConfirm={confirmTemplateModeDroneGate}
          onCancel={cancelTemplateModeDroneGate}
        />
      )}
    </div>
  );
}
