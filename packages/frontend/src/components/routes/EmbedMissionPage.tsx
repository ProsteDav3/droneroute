import { useState, useEffect, useMemo } from "react";
import Map, { Source, Layer, Marker } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { useConfigStore } from "@/store/configStore";
import { api } from "@/lib/api";
import { getObstacleWarnings } from "@/lib/geo";
import type { EmbedMission } from "@droneroute/shared";

interface EmbedMissionPageProps {
  shareToken: string;
}

/**
 * Minimal, read-only mission preview meant to be placed in an `<iframe>` on
 * a third-party site (`/embed/:shareToken`) — just the map and flight path,
 * with no editor chrome, header, or footer. Fetches its own data from the
 * dedicated `GET /api/embed/:shareToken` route (never the full
 * `GET /api/shared/:token`), so it never receives the owner's email or the
 * mission's internal DB id.
 */
export function EmbedMissionPage({ shareToken }: EmbedMissionPageProps) {
  const mapboxToken = useConfigStore((s) => s.mapboxToken);
  const [mission, setMission] = useState<EmbedMission | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<EmbedMission>(`/embed/${shareToken}`)
      .then((data) => {
        if (!cancelled) setMission(data);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.message || "Mise nebyla nalezena");
      });
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  const waypoints = mission?.waypoints ?? [];
  const obstacles = mission?.obstacles ?? [];
  const pois = mission?.pois ?? [];

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

  const flightPathGeojson = useMemo(() => {
    if (waypoints.length < 2) return null;
    const features = waypoints.slice(0, -1).map((wp, i) => {
      const next = waypoints[i + 1];
      return {
        type: "Feature" as const,
        properties: {
          color: warningSegments.has(wp.index) ? "#ef4444" : "#00c2ff",
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
  }, [waypoints, warningSegments]);

  const obstacleGeojson = useMemo(() => {
    const features = obstacles.map((obs) => {
      const ring = [
        ...obs.vertices.map(([lat, lng]) => [lng, lat]),
        [obs.vertices[0][1], obs.vertices[0][0]],
      ];
      return {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Polygon" as const, coordinates: [ring] },
      };
    });
    return { type: "FeatureCollection" as const, features };
  }, [obstacles]);

  const bounds = useMemo(() => {
    const allPoints = [
      ...waypoints.map((wp) => [wp.longitude, wp.latitude] as [number, number]),
      ...pois.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...obstacles.flatMap((o) =>
        o.vertices.map((v) => [v[1], v[0]] as [number, number]),
      ),
    ];
    if (allPoints.length === 0) return null;
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
    return [
      [minLng, minLat],
      [maxLng, maxLat],
    ] as [[number, number], [number, number]];
  }, [waypoints, pois, obstacles]);

  const center: [number, number] =
    waypoints.length > 0
      ? [waypoints[0].longitude, waypoints[0].latitude]
      : [2.1686, 41.3874];

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  if (!mapboxToken || !mission) {
    return <div className="h-screen w-screen bg-background" />;
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      <Map
        mapboxAccessToken={mapboxToken}
        initialViewState={{
          longitude: center[0],
          latitude: center[1],
          zoom: 14,
          ...(bounds
            ? { bounds, fitBoundsOptions: { padding: 40, maxZoom: 16 } }
            : {}),
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        doubleClickZoom={false}
        dragRotate={false}
        attributionControl={true}
      >
        {flightPathGeojson && (
          <Source
            id="embed-flight-path"
            type="geojson"
            data={flightPathGeojson}
          >
            <Layer
              id="embed-flight-path-line"
              type="line"
              paint={{
                "line-color": ["get", "color"],
                "line-width": 3,
                "line-opacity": 0.8,
                "line-dasharray": [2, 1.2],
              }}
            />
          </Source>
        )}

        {obstacles.length > 0 && (
          <Source id="embed-obstacles" type="geojson" data={obstacleGeojson}>
            <Layer
              id="embed-obstacles-fill"
              type="fill"
              paint={{ "fill-color": "#ef4444", "fill-opacity": 0.12 }}
            />
            <Layer
              id="embed-obstacles-outline"
              type="line"
              paint={{
                "line-color": "#ef4444",
                "line-width": 2,
                "line-opacity": 0.7,
              }}
            />
          </Source>
        )}

        {waypoints.map((wp, i) => (
          <Marker
            key={`wp-${wp.index}`}
            longitude={wp.longitude}
            latitude={wp.latitude}
            anchor="center"
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background:
                  i === 0
                    ? "#22c55e"
                    : i === waypoints.length - 1
                      ? "#ef4444"
                      : "#00c2ff",
                border: "2px solid #00c2ff",
              }}
            />
          </Marker>
        ))}

        {pois.map((poi) => (
          <Marker
            key={`poi-${poi.id}`}
            longitude={poi.longitude}
            latitude={poi.latitude}
            anchor="center"
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#f59e0b",
                border: "2px solid #f59e0b",
                opacity: 0.8,
              }}
            />
          </Marker>
        ))}
      </Map>
    </div>
  );
}
