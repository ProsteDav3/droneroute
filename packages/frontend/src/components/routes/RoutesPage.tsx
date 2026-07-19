import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  MapPin,
  Crosshair,
  Trash2,
  ArrowLeft,
  Plus,
  Calendar,
  Route,
  ArrowUp,
  Plane,
  Download,
  Share2,
  Link,
  Link2Off,
  Check,
  Copy,
  Briefcase,
  Search,
  Folder,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMissionStore } from "@/store/missionStore";
import { useAuthStore } from "@/store/authStore";
import { useConfigStore } from "@/store/configStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { formatDistance } from "@/lib/units";
import { estimateFlightStats, formatFlightDuration } from "@/lib/flightStats";
import { api } from "@/lib/api";
import { DRONE_MODELS } from "@droneroute/shared";
import type {
  Waypoint,
  MissionConfig,
  PointOfInterest,
  DroneModel,
} from "@droneroute/shared";
import { MissionVersionHistory } from "./MissionVersionHistory";
import { NewMissionDroneDialog } from "./NewMissionDroneDialog";

/** Sentinel value for the folder filter's "all folders" option — Radix `Select.Item` requires a non-empty `value`. */
const ALL_FOLDERS = "__all__";

interface SavedMission {
  id: string;
  name: string;
  client: string | null;
  folder: string | null;
  created_at: string;
  updated_at: string;
  config: string;
  waypoints: string;
  pois: string;
  obstacles: string;
  buildings: string;
  template_groups: string;
  share_token: string | null;
}

function getDroneLabel(config: MissionConfig): string | null {
  const model = DRONE_MODELS.find(
    (d) =>
      d.droneEnumValue === config.droneEnumValue &&
      d.droneSubEnumValue === config.droneSubEnumValue,
  );
  return model?.label ?? null;
}

interface RoutesPageProps {
  onRequestAuth: () => void;
}

export function RoutesPage({ onRequestAuth }: RoutesPageProps) {
  const { loadMission, setCurrentPage } = useMissionStore();
  const { token } = useAuthStore();
  const { selfHosted } = useConfigStore();
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const [missions, setMissions] = useState<SavedMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState(ALL_FOLDERS);
  const [historyMission, setHistoryMission] = useState<SavedMission | null>(
    null,
  );
  const [showNewMissionDialog, setShowNewMissionDialog] = useState(false);
  const missionDefaults = usePreferencesStore(
    (s) => s.preferences.missionDefaults,
  );

  const filteredMissions = useMemo(() => {
    const clientQuery = clientFilter.trim().toLowerCase();
    const nameQuery = searchQuery.trim().toLowerCase();
    return missions.filter((m) => {
      if (clientQuery && !(m.client ?? "").toLowerCase().includes(clientQuery))
        return false;
      if (nameQuery && !(m.name ?? "").toLowerCase().includes(nameQuery))
        return false;
      if (folderFilter !== ALL_FOLDERS && (m.folder ?? "") !== folderFilter)
        return false;
      return true;
    });
  }, [missions, clientFilter, searchQuery, folderFilter]);

  const hasAnyClient = missions.some((m) => m.client);
  const folderOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of missions) {
      if (m.folder) set.add(m.folder);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [missions]);

  const fetchMissions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<SavedMission[]>("/missions");
      setMissions(data);
    } catch (e: any) {
      setError(e.message || "Nepodařilo se načíst mise");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchMissions();
    } else {
      setLoading(false);
    }
  }, [token]);

  const handleLoad = async (mission: SavedMission) => {
    try {
      const waypoints = JSON.parse(mission.waypoints);
      const config = JSON.parse(mission.config);
      const pois = mission.pois ? JSON.parse(mission.pois) : [];
      const obstacles = mission.obstacles ? JSON.parse(mission.obstacles) : [];
      const buildings = mission.buildings ? JSON.parse(mission.buildings) : [];
      const templateGroups = mission.template_groups
        ? JSON.parse(mission.template_groups)
        : {};
      loadMission({
        id: mission.id,
        name: mission.name,
        client: mission.client,
        config,
        waypoints,
        pois,
        obstacles,
        buildings,
        templateGroups,
      });
      setCurrentPage("editor");
    } catch (e) {
      console.error("Failed to load mission:", e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Trvale smazat tuto trasu?")) return;
    try {
      await api.delete(`/missions/${id}`);
      setMissions((prev) => prev.filter((m) => m.id !== id));
    } catch (e: any) {
      toast.error("Smazání se nezdařilo: " + (e.message || "Neznámá chyba"));
    }
  };

  const [exportingId, setExportingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const handleShare = async (mission: SavedMission) => {
    setSharingId(mission.id);
    try {
      if (mission.share_token) {
        // Already shared — copy the link
        const shareUrl = `${window.location.origin}/shared/${mission.share_token}`;
        await navigator.clipboard.writeText(shareUrl);
        setCopiedId(mission.id);
        setTimeout(() => setCopiedId(null), 2000);
      } else {
        // Enable sharing
        const result = await api.post<{ shareToken: string; shareUrl: string }>(
          `/missions/${mission.id}/share`,
        );
        // Update local state
        setMissions((prev) =>
          prev.map((m) =>
            m.id === mission.id ? { ...m, share_token: result.shareToken } : m,
          ),
        );
        await navigator.clipboard.writeText(result.shareUrl);
        setCopiedId(mission.id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch (e: any) {
      toast.error("Sdílení se nezdařilo: " + (e.message || "Neznámá chyba"));
    } finally {
      setSharingId(null);
    }
  };

  const handleUnshare = async (mission: SavedMission) => {
    if (!confirm("Zrušit sdílení? Kdokoliv s odkazem ztratí přístup.")) return;
    try {
      await api.delete(`/missions/${mission.id}/share`);
      setMissions((prev) =>
        prev.map((m) =>
          m.id === mission.id ? { ...m, share_token: null } : m,
        ),
      );
    } catch (e: any) {
      toast.error(
        "Zrušení sdílení se nezdařilo: " + (e.message || "Neznámá chyba"),
      );
    }
  };

  const handleExportKmz = async (mission: SavedMission) => {
    setExportingId(mission.id);
    try {
      const waypoints: Waypoint[] = JSON.parse(mission.waypoints);
      const config: MissionConfig = JSON.parse(mission.config);
      const pois: PointOfInterest[] = mission.pois
        ? JSON.parse(mission.pois)
        : [];

      if (waypoints.length < 2) {
        toast.warning("Pro export je potřeba alespoň 2 body trasy");
        return;
      }

      const blob = await api.post<Blob>("/kmz/generate", {
        name: mission.name,
        config,
        waypoints,
        pois,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(mission.name || "mission").replace(/[^a-zA-Z0-9_-]/g, "_")}.kmz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(`Export selhal: ${err.message}`);
    } finally {
      setExportingId(null);
    }
  };

  const handleDuplicate = async (mission: SavedMission) => {
    setDuplicatingId(mission.id);
    try {
      // Server-side copy (owner-scoped) — a single request, and guarantees
      // the copy never carries over the share token, comments, or version
      // history, even if new copyable fields are added to missions later.
      const created = await api.post<{ id: string; name: string }>(
        `/missions/${mission.id}/duplicate`,
      );
      toast.success(`Trasa zduplikována jako „${created.name}“`);
      await fetchMissions();
    } catch (err: any) {
      toast.error(`Duplikace se nezdařila: ${err.message}`);
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleSetFolder = async (mission: SavedMission) => {
    const next = prompt(
      "Zadejte název složky (prázdné pro odebrání ze složky):",
      mission.folder || "",
    );
    if (next === null) return; // cancelled
    const folder = next.trim() || null;
    if (folder === mission.folder) return;
    try {
      await api.put(`/missions/${mission.id}`, { folder });
      setMissions((prev) =>
        prev.map((m) => (m.id === mission.id ? { ...m, folder } : m)),
      );
    } catch (e: any) {
      toast.error(
        "Nastavení složky se nezdařilo: " + (e.message || "Neznámá chyba"),
      );
    }
  };

  const handleNewRoute = () => {
    setShowNewMissionDialog(true);
  };

  const handleConfirmNewMission = (model: DroneModel) => {
    useMissionStore.getState().clearMission();
    // The drone/camera choice is saved with this mission specifically — the
    // account-wide default above only seeds a *new* mission's starting
    // point, so a pilot flying more than one model still needs to confirm
    // it per mission rather than being stuck with whatever the account
    // default happened to be.
    useMissionStore.getState().setConfig({
      droneEnumValue: model.droneEnumValue,
      droneSubEnumValue: model.droneSubEnumValue,
      payloadEnumValue: model.payloads[0]?.payloadEnumValue ?? 0,
      payloadSubEnumValue: model.payloads[0]?.payloadSubEnumValue ?? 0,
    });
    setShowNewMissionDialog(false);
    setCurrentPage("editor");
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
          <div className="flex items-center justify-between max-w-5xl mx-auto">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentPage("editor")}
                className="h-9 w-9"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                  <Route className="h-5 w-5 text-primary" />
                  Moje trasy
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {missions.length}{" "}
                  {missions.length === 1
                    ? "uložená trasa"
                    : missions.length >= 2 && missions.length <= 4
                      ? "uložené trasy"
                      : "uložených tras"}
                </p>
              </div>
            </div>
            <Button onClick={handleNewRoute} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              Nová trasa
            </Button>
          </div>
          {(missions.length > 0 || hasAnyClient) && (
            <div className="max-w-5xl mx-auto mt-3 flex flex-wrap items-center gap-2">
              <div className="relative max-w-xs flex-1 min-w-[160px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Hledat podle názvu trasy…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              {hasAnyClient && (
                <div className="relative max-w-xs flex-1 min-w-[160px]">
                  <Briefcase className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={clientFilter}
                    onChange={(e) => setClientFilter(e.target.value)}
                    placeholder="Filtrovat podle klienta/zakázky…"
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              )}
              {folderOptions.length > 0 && (
                <Select value={folderFilter} onValueChange={setFolderFilter}>
                  <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs gap-1.5">
                    <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="Všechny složky" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FOLDERS}>Všechny složky</SelectItem>
                    {folderOptions.map((folder) => (
                      <SelectItem key={folder} value={folder}>
                        {folder}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto">
            {loading && (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <div className="text-center">
                  <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                  <p className="text-sm">Načítání tras...</p>
                </div>
              </div>
            )}

            {!loading && !token && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Route className="h-12 w-12 mb-4 opacity-30" />
                <p className="text-lg font-medium mb-1">
                  Přihlaste se pro zobrazení svých tras
                </p>
                <p className="text-sm mb-4">
                  Vytvořte si účet pro ukládání a správu misí dronu
                </p>
                <Button size="sm" className="gap-1.5" onClick={onRequestAuth}>
                  Přihlásit se
                </Button>
              </div>
            )}

            {error && token && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <p className="text-sm text-destructive mb-2">{error}</p>
                <Button variant="outline" size="sm" onClick={fetchMissions}>
                  Zkusit znovu
                </Button>
              </div>
            )}

            {!loading && !error && token && missions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Route className="h-12 w-12 mb-4 opacity-30" />
                <p className="text-lg font-medium mb-1">
                  Zatím žádné uložené trasy
                </p>
                <p className="text-sm mb-4">
                  Vytvořte svou první misi s body trasy pro dron
                </p>
                <Button onClick={handleNewRoute} size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  Vytvořit trasu
                </Button>
              </div>
            )}

            {!loading &&
              !error &&
              token &&
              missions.length > 0 &&
              filteredMissions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <Search className="h-12 w-12 mb-4 opacity-30" />
                  <p className="text-lg font-medium mb-1">
                    Žádná trasa neodpovídá filtru
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setClientFilter("");
                      setSearchQuery("");
                      setFolderFilter(ALL_FOLDERS);
                    }}
                  >
                    Zrušit filtr
                  </Button>
                </div>
              )}

            {!loading && !error && token && filteredMissions.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredMissions.map((mission) => {
                  const waypoints: Waypoint[] = (() => {
                    try {
                      return JSON.parse(mission.waypoints);
                    } catch {
                      return [];
                    }
                  })();
                  const pois = (() => {
                    try {
                      return mission.pois ? JSON.parse(mission.pois) : [];
                    } catch {
                      return [];
                    }
                  })();
                  const config: MissionConfig | null = (() => {
                    try {
                      return JSON.parse(mission.config);
                    } catch {
                      return null;
                    }
                  })();
                  const { distanceM: dist, timeS: flightTime } =
                    estimateFlightStats(
                      waypoints,
                      config?.autoFlightSpeed ?? 7,
                    );
                  const droneLabel = config ? getDroneLabel(config) : null;
                  const maxAlt =
                    waypoints.length > 0
                      ? Math.max(...waypoints.map((w) => w.height))
                      : 0;

                  return (
                    <div
                      key={mission.id}
                      className="group bg-card border border-border rounded-lg overflow-hidden hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5 cursor-pointer"
                      onClick={() => handleLoad(mission)}
                    >
                      {/* Card gradient header */}
                      <div className="h-2 bg-gradient-to-r from-blue-500 via-purple-500 to-amber-500" />

                      <div className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1 mr-2 min-w-0">
                            <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                              {mission.name || "Trasa bez názvu"}
                            </h3>
                            {mission.client && (
                              <div className="flex items-center gap-1 text-[10px] text-amber-400 mt-0.5">
                                <Briefcase className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">
                                  {mission.client}
                                </span>
                              </div>
                            )}
                            {mission.folder && (
                              <div className="flex items-center gap-1 text-[10px] text-sky-400 mt-0.5">
                                <Folder className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">
                                  {mission.folder}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            {!selfHosted && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className={`h-7 w-7 ${mission.share_token ? "text-emerald-400 hover:text-emerald-300" : "text-muted-foreground hover:text-foreground"}`}
                                disabled={sharingId === mission.id}
                                title={
                                  mission.share_token
                                    ? copiedId === mission.id
                                      ? "Odkaz zkopírován!"
                                      : "Kopírovat odkaz ke sdílení"
                                    : "Sdílet trasu"
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleShare(mission);
                                }}
                              >
                                {copiedId === mission.id ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : mission.share_token ? (
                                  <Link className="h-3.5 w-3.5" />
                                ) : (
                                  <Share2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )}
                            {!selfHosted && mission.share_token && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                title="Zrušit sdílení"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUnshare(mission);
                                }}
                              >
                                <Link2Off className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              disabled={duplicatingId === mission.id}
                              title="Uložit jako kopii (např. pro příští návštěvu)"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicate(mission);
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Nastavit složku"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetFolder(mission);
                              }}
                            >
                              <Folder className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Historie verzí"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHistoryMission(mission);
                              }}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              disabled={exportingId === mission.id}
                              title="Stáhnout KMZ"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportKmz(mission);
                              }}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Smazat trasu"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(mission.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        {/* Drone model + shared badge */}
                        <div className="flex items-center gap-2 mb-2">
                          {droneLabel && (
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Plane className="h-3 w-3 text-purple-400" />
                              {droneLabel}
                            </div>
                          )}
                          {!selfHosted && mission.share_token && (
                            <div className="flex items-center gap-1 text-[11px] text-emerald-400">
                              <Share2 className="h-3 w-3" />
                              Sdíleno
                            </div>
                          )}
                        </div>

                        {/* Stats row */}
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-blue-400" />
                            {waypoints.length} WP
                          </span>
                          {pois.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Crosshair className="h-3 w-3 text-amber-400" />
                              {pois.length} POI
                            </span>
                          )}
                          {maxAlt > 0 && (
                            <span className="flex items-center gap-1">
                              <ArrowUp className="h-3 w-3 text-sky-400" />
                              {maxAlt}m
                            </span>
                          )}
                        </div>

                        {/* Distance + time row */}
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-3">
                          {dist > 0 && (
                            <span className="flex items-center gap-1">
                              <Route className="h-3 w-3 text-emerald-400" />
                              {formatDistance(dist, unitSystem)}
                            </span>
                          )}
                          {flightTime > 0 && (
                            <span className="flex items-center gap-1">
                              <span className="text-orange-400 text-[10px]">
                                ~
                              </span>
                              {formatFlightDuration(flightTime)}
                            </span>
                          )}
                        </div>

                        {/* Date */}
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                          <Calendar className="h-3 w-3" />
                          {formatDate(mission.updated_at || mission.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {historyMission && (
        <MissionVersionHistory
          missionId={historyMission.id}
          missionName={historyMission.name}
          onClose={() => setHistoryMission(null)}
          onRestored={() => {
            fetchMissions();
          }}
        />
      )}

      {showNewMissionDialog && (
        <NewMissionDroneDialog
          defaultDroneKey={`${missionDefaults.droneEnumValue}-${missionDefaults.droneSubEnumValue}`}
          onConfirm={handleConfirmNewMission}
          onCancel={() => setShowNewMissionDialog(false)}
        />
      )}
    </div>
  );
}
