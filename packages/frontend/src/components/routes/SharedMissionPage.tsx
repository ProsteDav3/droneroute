import { useState, useEffect, useMemo, type FormEvent } from "react";
import { toast } from "sonner";
import { formatDistance } from "@/lib/units";
import { estimateFlightStats, formatFlightDuration } from "@/lib/flightStats";
import {
  MapPin,
  Crosshair,
  Route,
  ArrowUp,
  Plane,
  Calendar,
  Download,
  Copy,
  User,
  ArrowLeft,
  MessageCircle,
  Send,
} from "lucide-react";
import Map, { Source, Layer, Marker } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMissionStore } from "@/store/missionStore";
import { useAuthStore } from "@/store/authStore";
import { useConfigStore } from "@/store/configStore";
import { api } from "@/lib/api";
import { DRONE_MODELS } from "@droneroute/shared";
import { getObstacleWarnings } from "@/lib/geo";
import type {
  Waypoint,
  MissionConfig,
  PointOfInterest,
  Obstacle,
  MissionComment,
} from "@droneroute/shared";

/** Kept in sync with the backend caps in missionValidation.ts — enforced there too, this is just immediate UX feedback. */
const MAX_COMMENT_AUTHOR_NAME_LEN = 80;
const MAX_COMMENT_TEXT_LEN = 2000;

/** Remembers the visitor's display name across shared missions on this browser, so they don't retype it every time. */
const AUTHOR_NAME_STORAGE_KEY = "droneroute_comment_author_name";

interface SharedMissionData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  shareToken: string;
  ownerEmail?: string;
  config: MissionConfig;
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  obstacles: Obstacle[];
}

function getDroneLabel(config: MissionConfig): string | null {
  const model = DRONE_MODELS.find(
    (d) =>
      d.droneEnumValue === config.droneEnumValue &&
      d.droneSubEnumValue === config.droneSubEnumValue,
  );
  return model?.label ?? null;
}

interface SharedMissionPageProps {
  shareToken: string;
  onRequestAuth: () => void;
}

/** Read-only map preview showing the flight path, waypoints, POIs, and obstacle polygons. */
function SharedMissionMap({
  waypoints,
  pois,
  obstacles,
}: {
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  obstacles: Obstacle[];
}) {
  const mapboxToken = useConfigStore((s) => s.mapboxToken);
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

  // Flight path GeoJSON
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

  // Obstacle polygons GeoJSON
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

  // Compute bounds for initial view
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

  if (!mapboxToken) return null;

  return (
    <div className="h-[360px] w-full rounded-lg overflow-hidden border border-border">
      <Map
        mapboxAccessToken={mapboxToken}
        initialViewState={{
          longitude: center[0],
          latitude: center[1],
          zoom: 14,
          ...(bounds
            ? {
                bounds: bounds,
                fitBoundsOptions: { padding: 40, maxZoom: 16 },
              }
            : {}),
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        doubleClickZoom={false}
        attributionControl={false}
      >
        {/* Flight path */}
        {flightPathGeojson && (
          <Source
            id="shared-flight-path"
            type="geojson"
            data={flightPathGeojson}
          >
            <Layer
              id="shared-flight-path-line"
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

        {/* Obstacle polygons */}
        {obstacles.length > 0 && (
          <Source id="shared-obstacles" type="geojson" data={obstacleGeojson}>
            <Layer
              id="shared-obstacles-fill"
              type="fill"
              paint={{ "fill-color": "#ef4444", "fill-opacity": 0.12 }}
            />
            <Layer
              id="shared-obstacles-outline"
              type="line"
              paint={{
                "line-color": "#ef4444",
                "line-width": 2,
                "line-opacity": 0.7,
              }}
            />
          </Source>
        )}

        {/* Waypoint markers */}
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

        {/* POI markers */}
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

/**
 * Comment thread on a publicly shared mission — no account required, just a
 * display name + text. This is the only place comments are shown; the
 * authenticated editor (RoutesPage) never surfaces them.
 */
function MissionCommentsSection({ shareToken }: { shareToken: string }) {
  const [comments, setComments] = useState<MissionComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorName, setAuthorName] = useState(
    () => localStorage.getItem(AUTHOR_NAME_STORAGE_KEY) || "",
  );
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchComments = async () => {
    setLoading(true);
    try {
      const data = await api.get<MissionComment[]>(
        `/shared/${shareToken}/comments`,
      );
      setComments(data);
    } catch {
      // A public read-only thread failing to load isn't worth an error
      // banner on top of the mission itself — just show an empty state.
      setComments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken]);

  const trimmedName = authorName.trim();
  const trimmedText = text.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    trimmedName.length <= MAX_COMMENT_AUTHOR_NAME_LEN &&
    trimmedText.length > 0 &&
    trimmedText.length <= MAX_COMMENT_TEXT_LEN;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const created = await api.post<MissionComment>(
        `/shared/${shareToken}/comments`,
        { authorName: trimmedName, text: trimmedText },
      );
      setComments((prev) => [...prev, created]);
      setText("");
      localStorage.setItem(AUTHOR_NAME_STORAGE_KEY, trimmedName);
    } catch (e: any) {
      toast.error(
        "Odeslání komentáře se nezdařilo: " + (e.message || "Neznámá chyba"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString("cs-CZ", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
        <MessageCircle className="h-4 w-4 text-primary" />
        Komentáře
        {comments.length > 0 && (
          <span className="text-xs font-normal text-muted-foreground">
            ({comments.length})
          </span>
        )}
      </h3>

      {loading && (
        <p className="text-xs text-muted-foreground mb-3">
          Načítání komentářů...
        </p>
      )}

      {!loading && comments.length === 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          Zatím žádné komentáře. Buďte první!
        </p>
      )}

      {!loading && comments.length > 0 && (
        <ul className="space-y-3 mb-4">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="bg-background rounded-lg p-3 border border-border"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-foreground">
                  {comment.authorName}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatDate(comment.createdAt)}
                </span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {comment.text}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        <Input
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          placeholder="Vaše jméno"
          maxLength={MAX_COMMENT_AUTHOR_NAME_LEN}
          className="h-8 text-xs"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Napište komentář…"
          maxLength={MAX_COMMENT_TEXT_LEN}
          rows={2}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={!canSubmit || submitting}
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            {submitting ? "Odesílání..." : "Odeslat komentář"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function SharedMissionPage({
  shareToken,
  onRequestAuth,
}: SharedMissionPageProps) {
  const { loadMission, setCurrentPage } = useMissionStore();
  const { token } = useAuthStore();
  const [mission, setMission] = useState<SharedMissionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    const fetchShared = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<SharedMissionData>(`/shared/${shareToken}`);
        setMission(data);
      } catch (e: any) {
        setError(e.message || "Mise nebyla nalezena");
      } finally {
        setLoading(false);
      }
    };
    fetchShared();
  }, [shareToken]);

  const handleLoadReadOnly = () => {
    if (!mission) return;
    loadMission({
      name: mission.name,
      config: mission.config,
      waypoints: mission.waypoints,
      pois: mission.pois,
      obstacles: mission.obstacles,
    });
    window.history.pushState({}, "", "/");
    setCurrentPage("editor");
  };

  const handleClone = async () => {
    if (!token) {
      onRequestAuth();
      return;
    }
    setCloning(true);
    try {
      const result = await api.post<{ id: string; name: string }>(
        `/shared/${shareToken}/clone`,
      );
      if (!mission) return;
      loadMission({
        id: result.id,
        name: result.name,
        config: mission.config,
        waypoints: mission.waypoints,
        pois: mission.pois,
        obstacles: mission.obstacles,
      });
      window.history.pushState({}, "", "/");
      setCurrentPage("editor");
    } catch (e: any) {
      toast.error(
        "Vytvoření kopie se nezdařilo: " + (e.message || "Neznámá chyba"),
      );
    } finally {
      setCloning(false);
    }
  };

  const handleExportKmz = async () => {
    if (!mission || mission.waypoints.length < 2) return;
    try {
      const blob = await api.post<Blob>("/kmz/generate", {
        name: mission.name,
        config: mission.config,
        waypoints: mission.waypoints,
        pois: mission.pois,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(mission.name || "mission").replace(/[^a-zA-Z0-9_-]/g, "_")}.kmz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(`Export selhal: ${err.message}`);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString("cs-CZ", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  window.history.pushState({}, "", "/");
                  setCurrentPage("editor");
                }}
                className="h-9 w-9"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                  <Route className="h-5 w-5 text-primary" />
                  Sdílená trasa
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Někdo s vámi sdílel misi dronu
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto">
            {loading && (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <div className="text-center">
                  <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                  <p className="text-sm">Načítání sdílené trasy...</p>
                </div>
              </div>
            )}

            {!loading && error && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Route className="h-12 w-12 mb-4 opacity-30" />
                <p className="text-lg font-medium mb-1">Trasa nenalezena</p>
                <p className="text-sm mb-4">
                  Tento sdílený odkaz mohl vypršet nebo být zrušen
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    window.history.pushState({}, "", "/");
                    setCurrentPage("editor");
                  }}
                >
                  Přejít do editoru
                </Button>
              </div>
            )}

            {!loading &&
              !error &&
              mission &&
              (() => {
                const { distanceM: dist, timeS: flightTime } =
                  estimateFlightStats(
                    mission.waypoints,
                    mission.config.autoFlightSpeed,
                  );
                const droneLabel = getDroneLabel(mission.config);
                const maxAlt =
                  mission.waypoints.length > 0
                    ? Math.max(...mission.waypoints.map((w) => w.height))
                    : 0;

                return (
                  <div className="bg-card border border-border rounded-lg overflow-hidden">
                    {/* Gradient header */}
                    <div className="h-2 bg-gradient-to-r from-emerald-500 via-blue-500 to-purple-500" />

                    <div className="p-6">
                      {/* Mission name */}
                      <h2 className="text-2xl font-bold text-foreground mb-2">
                        {mission.name || "Trasa bez názvu"}
                      </h2>

                      {/* Owner + date */}
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-6">
                        {mission.ownerEmail && (
                          <span className="flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5" />
                            {mission.ownerEmail}
                          </span>
                        )}
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDate(mission.updatedAt || mission.createdAt)}
                        </span>
                      </div>

                      {/* Stats grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                        {droneLabel && (
                          <div className="bg-background rounded-lg p-3 border border-border">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <Plane className="h-3 w-3 text-purple-400" />
                              Dron
                            </div>
                            <div className="text-sm font-medium text-foreground">
                              {droneLabel}
                            </div>
                          </div>
                        )}
                        <div className="bg-background rounded-lg p-3 border border-border">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                            <MapPin className="h-3 w-3 text-blue-400" />
                            Body trasy
                          </div>
                          <div className="text-sm font-medium text-foreground">
                            {mission.waypoints.length}
                            {mission.pois.length > 0 && (
                              <span className="text-xs text-muted-foreground ml-1">
                                + {mission.pois.length} POI
                              </span>
                            )}
                          </div>
                        </div>
                        {dist > 0 && (
                          <div className="bg-background rounded-lg p-3 border border-border">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <Route className="h-3 w-3 text-emerald-400" />
                              Vzdálenost
                            </div>
                            <div className="text-sm font-medium text-foreground">
                              {formatDistance(dist)}
                            </div>
                          </div>
                        )}
                        {maxAlt > 0 && (
                          <div className="bg-background rounded-lg p-3 border border-border">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <ArrowUp className="h-3 w-3 text-sky-400" />
                              Max. výška
                            </div>
                            <div className="text-sm font-medium text-foreground">
                              {maxAlt} m
                            </div>
                          </div>
                        )}
                        {flightTime > 0 && (
                          <div className="bg-background rounded-lg p-3 border border-border">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <Crosshair className="h-3 w-3 text-orange-400" />
                              Odhad. čas
                            </div>
                            <div className="text-sm font-medium text-foreground">
                              {formatFlightDuration(flightTime)}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Map preview */}
                      {mission.waypoints.length > 0 && (
                        <div className="mb-6">
                          <SharedMissionMap
                            waypoints={mission.waypoints}
                            pois={mission.pois}
                            obstacles={mission.obstacles}
                          />
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-3">
                        <Button onClick={handleLoadReadOnly} className="gap-2">
                          <Route className="h-4 w-4" />
                          Otevřít v editoru
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleClone}
                          disabled={cloning}
                          className="gap-2"
                        >
                          <Copy className="h-4 w-4" />
                          {cloning
                            ? "Vytváření kopie..."
                            : token
                              ? "Uložit do mých tras"
                              : "Přihlaste se pro vytvoření kopie"}
                        </Button>
                        {mission.waypoints.length >= 2 && (
                          <Button
                            variant="outline"
                            onClick={handleExportKmz}
                            className="gap-2"
                          >
                            <Download className="h-4 w-4" />
                            Export KMZ
                          </Button>
                        )}
                      </div>

                      <MissionCommentsSection shareToken={shareToken} />
                    </div>
                  </div>
                );
              })()}
          </div>
        </div>
      </div>
    </div>
  );
}
