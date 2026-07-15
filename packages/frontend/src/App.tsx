import { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Download,
  Upload,
  Save,
  Settings,
  MapPin,
  ChevronDown,
  ChevronRight,
  Crosshair,
  FolderOpen,
  Route,
  Clock,
  User,
  LogOut,
  Camera,
  Video,
  TrendingUp,
  UserCog,
  CircleHelp,
  Triangle,
  Shield,
  Scissors,
  FolderPlus,
  Warehouse,
  Bookmark,
  CloudSun,
  BatteryFull,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapView } from "@/components/map/MapView";
import { WaypointList } from "@/components/waypoint/WaypointList";
import { BulkActionToolbar } from "@/components/waypoint/BulkActionToolbar";
import { MissionConfig } from "@/components/mission/MissionConfig";
import { PoiList } from "@/components/mission/PoiList";
import { ObstacleList } from "@/components/mission/ObstacleList";
import { BuildingList } from "@/components/mission/BuildingList";
import { TemplatePresetList } from "@/components/mission/TemplatePresetList";
import { WeatherForecast } from "@/components/mission/WeatherForecast";
import { useTemplatePresetsStore } from "@/store/templatePresetsStore";
import { RoutesPage } from "@/components/routes/RoutesPage";
import { SharedMissionPage } from "@/components/routes/SharedMissionPage";
import { AdminPage } from "@/pages/AdminPage";
import { ElevationGraph } from "@/components/mission/ElevationGraph";
import { WarningsPanel } from "@/components/mission/WarningsPanel";
import type { Warning } from "@/components/mission/WarningsPanel";
import { AuthModal } from "@/components/auth/AuthModal";
import { LoginGate } from "@/components/auth/LoginGate";
import { AccountModal } from "@/components/auth/AccountModal";
import { AboutDialog } from "@/components/AboutDialog";
import { WelcomeDialog } from "@/components/WelcomeDialog";
import { useMissionStore } from "@/store/missionStore";
import { useAuthStore } from "@/store/authStore";
import { useConfigStore } from "@/store/configStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { formatDistance } from "@/lib/units";
import { useAirspaceStore } from "@/store/airspaceStore";
import { api } from "@/lib/api";
import { getObstacleWarnings, getAirspaceWarnings } from "@/lib/geo";
import { estimateFlightStats, formatFlightDuration } from "@/lib/flightStats";

type SidebarSection =
  | "waypoints"
  | "pois"
  | "obstacles"
  | "buildings"
  | "presets"
  | "weather"
  | "config";

export default function App() {
  const {
    missionName,
    setMissionName,
    missionId,
    setMissionId,
    config,
    waypoints,
    pois,
    obstacles,
    buildings,
    templateGroups,
    loadMission,
    currentPage,
    setCurrentPage,
    shareToken,
    setShareToken,
    dirty,
    setDirty,
  } = useMissionStore();

  const [expandedSections, setExpandedSections] = useState<
    Record<SidebarSection, boolean>
  >({
    waypoints: true,
    pois: false,
    obstacles: false,
    buildings: false,
    presets: false,
    weather: false,
    config: false,
  });

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingSegments, setExportingSegments] = useState(false);
  const [savingSegments, setSavingSegments] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    token,
    email: userEmail,
    logout,
    restore,
    isAdmin,
    hasRestored,
  } = useAuthStore();
  const { selfHosted } = useConfigStore();
  const [gravatarUrl, setGravatarUrl] = useState<string | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // Restore auth session on mount
  useEffect(() => {
    restore();
  }, []);

  // Fetch user preferences after auth is restored
  const { fetchPreferences, preferences } = usePreferencesStore();
  const unitSystem = preferences.unitSystem;
  useEffect(() => {
    if (token) {
      fetchPreferences();
    }
  }, [token]);

  // Fetch saved template presets after auth is restored
  const { presets, fetchPresets } = useTemplatePresetsStore();
  useEffect(() => {
    if (token) {
      fetchPresets();
    }
  }, [token]);

  // Detect /shared/:token or /admin URL on mount
  useEffect(() => {
    const match = window.location.pathname.match(/^\/shared\/([^/]+)$/);
    if (match) {
      setShareToken(match[1]);
      setCurrentPage("shared");
    } else if (window.location.pathname === "/admin") {
      const token = localStorage.getItem("droneroute_token");
      const adminFlag = localStorage.getItem("droneroute_is_admin") === "true";
      if (token && adminFlag) {
        setCurrentPage("admin");
      } else {
        window.history.replaceState({}, "", "/");
      }
    }
  }, []);

  // Warn before closing/navigating away with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (
        dirty &&
        (waypoints.length > 1 ||
          pois.length > 0 ||
          obstacles.length > 0 ||
          buildings.length > 0)
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [
    dirty,
    waypoints.length,
    pois.length,
    obstacles.length,
    buildings.length,
  ]);

  // Obstacle warnings
  const obstacleWarnings = useMemo(
    () => getObstacleWarnings(waypoints, obstacles),
    [waypoints, obstacles],
  );

  // Airspace warnings
  const airspaceZones = useAirspaceStore((s) => s.zones);
  const airspaceEnabled = useAirspaceStore((s) => s.enabled);
  const airspaceWarnings = useMemo(
    () =>
      airspaceEnabled ? getAirspaceWarnings(waypoints, airspaceZones) : [],
    [waypoints, airspaceZones, airspaceEnabled],
  );

  // Compute flight stats for warnings
  const flightStats = useMemo(
    () =>
      waypoints.length >= 2
        ? estimateFlightStats(waypoints, config.autoFlightSpeed)
        : null,
    [waypoints, config.autoFlightSpeed],
  );

  // Summary across a whole segmented project (export/save segments): each
  // consecutive-pair segment is its own standalone flight (own take-off,
  // own landing), so — unlike flightStats above, which ramps up/down once
  // for the full continuous route — this estimates each segment as its own
  // independent flight, then reports how many separate flights/battery
  // cycles the whole revisit schedule will actually need.
  const segmentsSummary = useMemo(() => {
    if (waypoints.length < 2) return null;
    const segmentCount = waypoints.length - 1;
    let totalTimeS = 0;
    let maxSegmentTimeS = 0;
    for (let i = 0; i < segmentCount; i++) {
      const { timeS } = estimateFlightStats(
        [waypoints[i], waypoints[i + 1]],
        config.autoFlightSpeed,
      );
      totalTimeS += timeS;
      maxSegmentTimeS = Math.max(maxSegmentTimeS, timeS);
    }
    return {
      segmentCount,
      totalTimeS,
      exceedsBattery: maxSegmentTimeS > config.maxBatteryMinutes * 60,
    };
  }, [waypoints, config.autoFlightSpeed, config.maxBatteryMinutes]);

  // Aggregated warnings for overlay
  const warnings = useMemo(() => {
    const result: Warning[] = [];
    if (obstacles.length > 0 && obstacleWarnings.length > 0) {
      result.push({
        id: "obstacle",
        type: "obstacle",
        message: `${obstacleWarnings.length} upozornění na překážky — body trasy zasahují do zakázaných zón`,
      });
    }
    if (flightStats && flightStats.timeS > config.maxBatteryMinutes * 60) {
      result.push({
        id: "battery",
        type: "battery",
        message: `Doba letu (${formatFlightDuration(flightStats.timeS)}) přesahuje maximální kapacitu baterie (${config.maxBatteryMinutes} min)`,
      });
    }
    // Airspace zone warnings
    const prohibitedCount = airspaceWarnings.filter(
      (w) => w.severity === "prohibited",
    ).length;
    const restrictedCount = airspaceWarnings.filter(
      (w) => w.severity === "restricted",
    ).length;
    if (prohibitedCount > 0) {
      result.push({
        id: "airspace-prohibited",
        type: "airspace",
        message: `Trasa letu vstupuje do ${prohibitedCount} ${prohibitedCount === 1 ? "zakázané vzdušné zóny" : "zakázaných vzdušných zón"} — let není povolen`,
      });
    }
    if (restrictedCount > 0) {
      result.push({
        id: "airspace-restricted",
        type: "airspace",
        message: `Trasa letu vstupuje do ${restrictedCount} ${restrictedCount === 1 ? "omezené vzdušné zóny" : "omezených vzdušných zón"} — může být vyžadováno povolení`,
      });
    }
    return result;
  }, [
    obstacleWarnings,
    obstacles.length,
    flightStats,
    config.maxBatteryMinutes,
    airspaceWarnings,
  ]);

  // Compute Gravatar URL when email changes
  useEffect(() => {
    if (!userEmail) {
      setGravatarUrl(null);
      return;
    }
    const trimmed = userEmail.trim().toLowerCase();
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(trimmed))
      .then((buf) => {
        const hex = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        setGravatarUrl(`https://www.gravatar.com/avatar/${hex}?s=64&d=mp`);
      });
  }, [userEmail]);

  const toggleSection = (section: SidebarSection) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleExport = async () => {
    if (waypoints.length < 2) {
      toast.warning("Pro export je potřeba alespoň 2 body trasy");
      return;
    }

    setExporting(true);
    try {
      const blob = await api.post<Blob>("/kmz/generate", {
        name: missionName,
        config,
        waypoints,
        pois,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${missionName.replace(/[^a-zA-Z0-9_-]/g, "_")}.kmz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(`Export selhal: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportSegments = async () => {
    if (waypoints.length < 2) {
      toast.warning("Pro export segmentů je potřeba alespoň 2 body trasy");
      return;
    }

    setExportingSegments(true);
    try {
      const blob = await api.post<Blob>("/kmz/generate-segments", {
        name: missionName,
        config,
        waypoints,
        pois,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${missionName.replace(/[^a-zA-Z0-9_-]/g, "_")}-segments.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(`Export segmentů selhal: ${err.message}`);
    } finally {
      setExportingSegments(false);
    }
  };

  const handleSaveSegments = async () => {
    if (!token) {
      setShowAuthModal(true);
      return;
    }
    if (waypoints.length < 2) {
      toast.warning("Pro uložení segmentů je potřeba alespoň 2 body trasy");
      return;
    }
    if (!missionName.trim()) {
      toast.warning("Před uložením zadejte název mise");
      return;
    }

    setSavingSegments(true);
    try {
      const created = await api.post<{ id: string; name: string }[]>(
        "/missions/segments",
        {
          name: missionName,
          config,
          waypoints,
          pois,
          obstacles,
          buildings,
          templateGroups,
        },
      );
      toast.success(`Uloženo ${created.length} samostatných misí`);
    } catch (err: any) {
      toast.error(`Uložení segmentů selhalo: ${err.message}`);
    } finally {
      setSavingSegments(false);
    }
  };

  const handleSave = async () => {
    if (!token) {
      setShowAuthModal(true);
      return;
    }
    if (!missionName.trim()) {
      toast.warning("Před uložením zadejte název mise");
      return;
    }
    setSaving(true);
    try {
      if (missionId) {
        await api.put(`/missions/${missionId}`, {
          name: missionName,
          config,
          waypoints,
          pois,
          obstacles,
          buildings,
          templateGroups,
        });
      } else {
        const result = await api.post<{ id: string }>("/missions", {
          name: missionName,
          config,
          waypoints,
          pois,
          obstacles,
          buildings,
          templateGroups,
        });
        setMissionId(result.id);
      }
      setDirty(false);
    } catch (err: any) {
      toast.error(`Uložení selhalo: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const result = await api.post<{
        config: any;
        waypoints: any[];
        pois?: any[];
      }>("/kmz/import", formData);
      loadMission({
        name: file.name.replace(/\.kmz$/i, ""),
        config: result.config,
        waypoints: result.waypoints,
        pois: result.pois,
      });
    } catch (err: any) {
      toast.error(`Import selhal: ${err.message}`);
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/selects (except Escape which should always work)
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        e.key !== "Escape" &&
        (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
      )
        return;

      const {
        setIsAddingWaypoint,
        setIsAddingPoi,
        setIsDrawingObstacle,
        setIsDrawingBuilding,
        setTemplateMode,
        setEditingTemplateGroupId,
        clearWaypointSelection,
        removeSelectedWaypoints,
        selectAllWaypoints,
        selectedWaypointIndices,
        templateMode,
      } = useMissionStore.getState();

      switch (e.key.toLowerCase()) {
        case "w":
          e.preventDefault();
          setIsAddingWaypoint(true);
          break;
        case "p":
          if (e.metaKey || e.ctrlKey) return; // don't intercept Cmd+P
          e.preventDefault();
          setIsAddingPoi(true);
          break;
        case "o":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setTemplateMode(templateMode === "orbit" ? null : "orbit");
          break;
        case "g":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setTemplateMode(templateMode === "grid" ? null : "grid");
          break;
        case "f":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setTemplateMode(templateMode === "facade" ? null : "facade");
          break;
        case "z":
          if (e.metaKey || e.ctrlKey) return; // don't intercept Cmd+Z (undo)
          e.preventDefault();
          setTemplateMode(templateMode === "pencil" ? null : "pencil");
          break;
        case "s":
          if (e.metaKey || e.ctrlKey) return; // don't intercept Cmd+S (save)
          e.preventDefault();
          setTemplateMode(templateMode === "solar" ? null : "solar");
          break;
        case "b":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setIsDrawingObstacle(!useMissionStore.getState().isDrawingObstacle);
          break;
        case "h":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setIsDrawingBuilding(!useMissionStore.getState().isDrawingBuilding);
          break;
        case "a":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            selectAllWaypoints();
          } else {
            e.preventDefault();
            const as = useAirspaceStore.getState();
            as.setEnabled(!as.enabled);
          }
          break;
        case "escape":
          e.preventDefault();
          clearWaypointSelection();
          setIsAddingWaypoint(false);
          setIsAddingPoi(false);
          setIsDrawingObstacle(false);
          setIsDrawingBuilding(false);
          setTemplateMode(null);
          setEditingTemplateGroupId(null);
          break;
        case "delete":
        case "backspace":
          if (selectedWaypointIndices.size > 0) {
            e.preventDefault();
            if (selectedWaypointIndices.size > 1) {
              if (
                confirm(`Smazat ${selectedWaypointIndices.size} bodů trasy?`)
              ) {
                removeSelectedWaypoints();
              }
            } else {
              removeSelectedWaypoints();
            }
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // The shared-mission page is intentionally public (that's the whole point
  // of a share link); everything else requires signing in. Wait for
  // hasRestored so a returning, already-logged-in user doesn't flash the
  // login screen before the stored token is read back from localStorage.
  if (hasRestored && !token && currentPage !== "shared") {
    return <LoginGate />;
  }
  if (!hasRestored && currentPage !== "shared") {
    return null;
  }

  // Show admin page
  if (currentPage === "admin") {
    return <AdminPage />;
  }

  // Show routes page
  if (currentPage === "routes") {
    return (
      <>
        <RoutesPage onRequestAuth={() => setShowAuthModal(true)} />
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      </>
    );
  }

  // Show shared mission page
  if (currentPage === "shared" && shareToken) {
    return (
      <>
        <SharedMissionPage
          shareToken={shareToken}
          onRequestAuth={() => setShowAuthModal(true)}
        />
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      </>
    );
  }

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <div className="w-88 flex flex-col border-r border-border bg-card shrink-0 tabular-nums">
        {/* Header */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <img
                src="/skyroute-icon.svg"
                alt="SkyRoute"
                className="h-5 w-5"
              />
              <span className="font-bold text-sm">SkyRoute</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAbout(true)}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Nápověda a klávesové zkratky"
              >
                <CircleHelp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentPage("routes")}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Moje trasy"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
              {!selfHosted && isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    window.history.pushState({}, "", "/admin");
                    setCurrentPage("admin");
                  }}
                  className="h-7 w-7 text-purple-400 hover:text-purple-300"
                  title="Správa uživatelů"
                >
                  <Shield className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <Input
            value={missionName}
            onChange={(e) => setMissionName(e.target.value)}
            className="h-8 text-xs font-medium border-[#00c2ff]/30 bg-[#00c2ff]/5 focus-visible:ring-[#00c2ff]/40"
            placeholder="Název mise"
            title="Pojmenujte misi pro snadnou identifikaci"
          />
        </div>

        {/* Toolbar */}
        <div className="flex gap-1 p-2 border-b border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 text-xs h-7 border-[#00c2ff]/30 bg-[#00c2ff]/5 hover:bg-[#00c2ff]/15 hover:text-[#33cfff]"
            title="Uložit misi do vašeho účtu"
          >
            <Save className="h-3 w-3" />
            {saving ? "..." : "Uložit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || waypoints.length < 2}
            className="flex-1 text-xs h-7 border-[#00c2ff]/30 bg-[#00c2ff]/5 hover:bg-[#00c2ff]/15 hover:text-[#33cfff]"
            title={
              waypoints.length < 2
                ? "Pro export přidejte alespoň 2 body trasy"
                : "Exportovat misi jako soubor DJI KMZ"
            }
          >
            <Download className="h-3 w-3" />
            {exporting ? "..." : "Export KMZ"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 text-xs h-7 border-[#00c2ff]/30 bg-[#00c2ff]/5 hover:bg-[#00c2ff]/15 hover:text-[#33cfff]"
            title="Importovat soubor DJI KMZ"
          >
            <Upload className="h-3 w-3" />
            Import KMZ
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".kmz"
            className="hidden"
            onChange={handleImport}
          />
        </div>
        <div className="flex flex-col gap-1 px-2 pb-2 border-b border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportSegments}
            disabled={exportingSegments || waypoints.length < 2}
            className="w-full text-xs h-7 border-[#00c2ff]/30 bg-[#00c2ff]/5 hover:bg-[#00c2ff]/15 hover:text-[#33cfff]"
            title={
              waypoints.length < 2
                ? "Pro export segmentů přidejte alespoň 2 body trasy"
                : "Rozdělit trasu na jednotlivé úseky (WP1→WP2, WP2→WP3, ...) a stáhnout je všechny jako zip souborů .kmz"
            }
          >
            <Scissors className="h-3 w-3" />
            {exportingSegments ? "..." : "Export segmentů (.zip)"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveSegments}
            disabled={savingSegments || waypoints.length < 2}
            className="w-full text-xs h-7 border-[#00c2ff]/30 bg-[#00c2ff]/5 hover:bg-[#00c2ff]/15 hover:text-[#33cfff]"
            title={
              waypoints.length < 2
                ? "Pro uložení segmentů přidejte alespoň 2 body trasy"
                : "Rozdělit trasu na jednotlivé úseky (WP1→WP2, WP2→WP3, ...) a uložit je jako samostatné mise ve vašem účtu"
            }
          >
            <FolderPlus className="h-3 w-3" />
            {savingSegments ? "..." : "Uložit segmenty jako mise"}
          </Button>
          {segmentsSummary && (
            <div
              className={`flex items-center gap-3 text-[10px] px-1 ${
                segmentsSummary.exceedsBattery
                  ? "text-orange-300"
                  : "text-muted-foreground"
              }`}
              title={
                segmentsSummary.exceedsBattery
                  ? `Nejdelší jednotlivý segment přesahuje maximální kapacitu baterie (${config.maxBatteryMinutes} min) — zvažte kratší úseky`
                  : "Odhad pro celý projekt, pokud se každý segment létá jako samostatný let s vlastní baterií"
              }
            >
              <span className="flex items-center gap-1">
                <BatteryFull
                  className={`h-3 w-3 ${segmentsSummary.exceedsBattery ? "text-orange-400" : "text-emerald-400"}`}
                />
                {segmentsSummary.segmentCount}{" "}
                {segmentsSummary.segmentCount === 1 ? "let" : "letů"}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-yellow-400" />
                {formatFlightDuration(segmentsSummary.totalTimeS)} celkem
              </span>
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Waypoints section — brand cyan accent */}
          <div className="border-l-2 border-[#00c2ff]/70 bg-[#00c2ff]/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-[#00c2ff]/10 hover:bg-[#00c2ff]/15 text-[#33cfff]"
              onClick={() => toggleSection("waypoints")}
              title="Souřadnice letové trasy — přidáte kliknutím na mapu"
            >
              {expandedSections.waypoints ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <MapPin className="h-3 w-3" />
              Body trasy ({waypoints.length})
            </button>
            {expandedSections.waypoints && (
              <div className="max-h-[40vh] overflow-y-auto section-expand">
                <WaypointList />
              </div>
            )}
          </div>

          {/* POIs section — AMBER/ORANGE accent */}
          <div className="border-l-2 border-amber-500/70 bg-amber-500/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-amber-500/10 hover:bg-amber-500/15 text-amber-400"
              onClick={() => toggleSection("pois")}
              title="Cíle, na které může dron namířit kameru"
            >
              {expandedSections.pois ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Crosshair className="h-3 w-3" />
              Body zájmu (POI) ({pois.length})
            </button>
            {expandedSections.pois && (
              <div className="max-h-[30vh] overflow-y-auto section-expand">
                <PoiList />
              </div>
            )}
          </div>

          {/* Obstacles section — RED accent */}
          <div className="border-l-2 border-red-500/70 bg-red-500/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-red-500/10 hover:bg-red-500/15 text-red-400"
              onClick={() => toggleSection("obstacles")}
              title="Zakázané zóny, kterým se má mise vyhnout"
            >
              {expandedSections.obstacles ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Triangle className="h-3 w-3" />
              Překážky ({obstacles.length})
            </button>
            {expandedSections.obstacles && (
              <div className="max-h-[30vh] overflow-y-auto section-expand">
                <ObstacleList />
              </div>
            )}
          </div>

          {/* Buildings section — BLUE accent */}
          <div className="border-l-2 border-blue-500/70 bg-blue-500/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-blue-500/10 hover:bg-blue-500/15 text-blue-400"
              onClick={() => toggleSection("buildings")}
              title="Půdorysy budov — pomáhají doporučit nastavení orbitu při umístění POI na budovu"
            >
              {expandedSections.buildings ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Warehouse className="h-3 w-3" />
              Budovy ({buildings.length})
            </button>
            {expandedSections.buildings && (
              <div className="max-h-[30vh] overflow-y-auto section-expand">
                <BuildingList />
              </div>
            )}
          </div>

          {/* Template presets section — INDIGO accent */}
          <div className="border-l-2 border-indigo-500/70 bg-indigo-500/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-indigo-500/10 hover:bg-indigo-500/15 text-indigo-400"
              onClick={() => toggleSection("presets")}
              title="Uložená nastavení šablon, znovupoužitelná napříč misemi"
            >
              {expandedSections.presets ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Bookmark className="h-3 w-3" />
              Přednastavené šablony ({presets.length})
            </button>
            {expandedSections.presets && (
              <div className="max-h-[30vh] overflow-y-auto section-expand">
                <TemplatePresetList />
              </div>
            )}
          </div>

          {/* Weather forecast section — SKY accent */}
          <div className="border-l-2 border-sky-500/70 bg-sky-500/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-sky-500/10 hover:bg-sky-500/15 text-sky-400"
              onClick={() => toggleSection("weather")}
              title="Předpověď větru a srážek pro místo mise"
            >
              {expandedSections.weather ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <CloudSun className="h-3 w-3" />
              Předpověď počasí
            </button>
            {expandedSections.weather && (
              <div className="max-h-[30vh] overflow-y-auto section-expand">
                <WeatherForecast />
              </div>
            )}
          </div>

          {/* Mission Settings section — PURPLE accent */}
          <div className="border-l-2 border-purple-500/70 bg-purple-500/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-purple-500/10 hover:bg-purple-500/15 text-purple-400"
              onClick={() => toggleSection("config")}
              title="Model dronu, rychlost, výška a chování letu"
            >
              {expandedSections.config ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Settings className="h-3 w-3" />
              Nastavení mise
            </button>
            {expandedSections.config && (
              <div className="max-h-[40vh] overflow-y-auto section-expand">
                <MissionConfig />
              </div>
            )}
          </div>
        </div>

        {/* Elevation graph */}
        <ElevationGraph />

        {/* Footer stats with colored icons */}
        <div className="px-3 py-2 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(() => {
              const photoCount = waypoints.reduce(
                (sum, wp) =>
                  sum +
                  wp.actions.filter((a) => a.actionType === "takePhoto").length,
                0,
              );
              const videoCount = waypoints.reduce(
                (sum, wp) =>
                  sum +
                  wp.actions.filter((a) => a.actionType === "startRecord")
                    .length,
                0,
              );
              return (
                <>
                  {photoCount > 0 && (
                    <span
                      className="flex items-center gap-1 text-[11px]"
                      title="Akce fotografování"
                    >
                      <Camera className="h-3 w-3 text-sky-400" />
                      <span className="text-sky-300 font-medium">
                        {photoCount}
                      </span>
                    </span>
                  )}
                  {videoCount > 0 && (
                    <span
                      className="flex items-center gap-1 text-[11px]"
                      title="Akce natáčení videa"
                    >
                      <Video className="h-3 w-3 text-red-400" />
                      <span className="text-red-300 font-medium">
                        {videoCount}
                      </span>
                    </span>
                  )}
                </>
              );
            })()}
          </div>
          <div className="flex items-center gap-3">
            {waypoints.length >= 2 && flightStats
              ? (() => {
                  const { distanceM: distance, timeS: time } = flightStats;
                  const elevGain = waypoints.reduce((sum, wp, i) => {
                    if (i === 0) return 0;
                    const diff = wp.height - waypoints[i - 1].height;
                    return sum + (diff > 0 ? diff : 0);
                  }, 0);
                  const exceedsBattery = time > config.maxBatteryMinutes * 60;
                  return (
                    <>
                      {elevGain > 0 && (
                        <span
                          className="flex items-center gap-1 text-[11px]"
                          title="Převýšení"
                        >
                          <TrendingUp className="h-3 w-3 text-orange-400" />
                          <span className="text-orange-300 font-medium">
                            {elevGain}m
                          </span>
                        </span>
                      )}
                      <span
                        className="flex items-center gap-1 text-[11px]"
                        title="Celková vzdálenost"
                      >
                        <Route className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-300 font-medium">
                          {formatDistance(distance, unitSystem)}
                        </span>
                      </span>
                      <span
                        className="flex items-center gap-1 text-[11px]"
                        title={
                          exceedsBattery
                            ? `Přesahuje maximální kapacitu baterie (${config.maxBatteryMinutes} min)`
                            : "Odhadovaný čas letu"
                        }
                      >
                        <Clock
                          className={`h-3 w-3 ${exceedsBattery ? "text-orange-400" : "text-yellow-400"}`}
                        />
                        <span
                          className={`font-medium ${exceedsBattery ? "text-orange-300" : "text-yellow-300"}`}
                        >
                          {formatFlightDuration(time)}
                        </span>
                      </span>
                    </>
                  );
                })()
              : null}
          </div>
        </div>

        {/* Auth row */}
        <div className="px-3 py-2 border-t border-border">
          {token ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {gravatarUrl ? (
                  <img
                    src={gravatarUrl}
                    alt=""
                    className="h-6 w-6 rounded-full shrink-0"
                  />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <User className="h-3 w-3 text-muted-foreground" />
                  </div>
                )}
                <span
                  className="text-[11px] text-muted-foreground truncate"
                  title={userEmail || ""}
                >
                  {userEmail}
                </span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAccountMenu(true)}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  title="Nastavení účtu"
                >
                  <UserCog className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={logout}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  title="Odhlásit se"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAuthModal(true)}
              className="w-full h-7 text-[11px] text-muted-foreground hover:text-foreground gap-1.5 justify-start px-1"
            >
              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="h-3 w-3 text-muted-foreground" />
              </div>
              Nepřihlášeno. Přihlaste se pro uložení misí
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 relative">
        <MapView />
        <BulkActionToolbar />
        <WarningsPanel warnings={warnings} />
      </div>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showAccountMenu && (
        <AccountModal onClose={() => setShowAccountMenu(false)} />
      )}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      <WelcomeDialog />
    </div>
  );
}
