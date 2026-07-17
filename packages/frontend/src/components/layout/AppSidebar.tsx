import type { RefObject } from "react";
import type mapboxgl from "mapbox-gl";
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
  FileText,
  FileSpreadsheet,
  CloudUpload,
  PanelLeftClose,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaypointList } from "@/components/waypoint/WaypointList";
import { MissionConfig } from "@/components/mission/MissionConfig";
import { PoiList } from "@/components/mission/PoiList";
import { ObstacleList } from "@/components/mission/ObstacleList";
import { BuildingList } from "@/components/mission/BuildingList";
import { TemplatePresetList } from "@/components/mission/TemplatePresetList";
import { WeatherForecast } from "@/components/mission/WeatherForecast";
import { DjiCloudOpsPanel } from "@/components/mission/DjiCloudOpsPanel";
import { DjiWaylineLibraryPanel } from "@/components/mission/DjiWaylineLibraryPanel";
import { ElevationGraph } from "@/components/mission/ElevationGraph";
import { formatDistance, formatDataSize } from "@/lib/units";
import { estimateMissionPhotoData } from "@/lib/solarCamera";
import { formatFlightDuration, countCaptureActions } from "@/lib/flightStats";
import type { estimateFlightStats } from "@/lib/flightStats";
import type {
  MissionConfig as MissionConfigType,
  Waypoint,
  UnitSystem,
} from "@droneroute/shared";

export type SidebarSection =
  | "waypoints"
  | "pois"
  | "obstacles"
  | "buildings"
  | "presets"
  | "weather"
  | "config";

interface SegmentsSummary {
  segmentCount: number;
  totalTimeS: number;
  exceedsBattery: boolean;
}

interface AppSidebarProps {
  missionName: string;
  setMissionName: (name: string) => void;
  missionClient: string;
  setMissionClient: (client: string) => void;
  setPanelsHidden: (value: boolean | ((prev: boolean) => boolean)) => void;
  setShowAbout: (show: boolean) => void;
  setCurrentPage: (page: "routes" | "admin") => void;
  selfHosted: boolean;
  isAdmin: boolean;

  handleSave: () => void;
  saving: boolean;
  handleExport: () => void;
  exporting: boolean;
  handleImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleDownloadReport: () => void;
  generatingReport: boolean;
  handleExportPhotogrammetryCsv: () => void;
  djiCloudEnabled: boolean;
  handleUploadToDjiCloud: () => void;
  uploadingToDjiCloud: boolean;
  handleUploadSegmentsToDjiCloud: () => void;
  uploadingSegmentsToDjiCloud: boolean;
  handleExportSegments: () => void;
  exportingSegments: boolean;
  handleSaveSegments: () => void;
  savingSegments: boolean;
  segmentsSummary: SegmentsSummary | null;

  config: MissionConfigType;
  waypoints: Waypoint[];
  flightStats: ReturnType<typeof estimateFlightStats> | null;
  unitSystem: UnitSystem;

  expandedSections: Record<SidebarSection, boolean>;
  toggleSection: (section: SidebarSection) => void;
  poiCount: number;
  obstacleCount: number;
  buildingCount: number;
  presetCount: number;

  mapRef: RefObject<mapboxgl.Map | null>;

  gravatarUrl: string | null;
  userEmail: string | null;
  token: string | null;
  setShowAccountMenu: (show: boolean) => void;
  logout: () => void;
  setShowAuthModal: (show: boolean) => void;
}

/** The left-hand editor chrome — mission name/client, save/export/import
 * toolbar, the collapsible waypoint/POI/obstacle/building/preset/weather/
 * config sections, DJI Cloud fleet panels, elevation graph, footer stats,
 * and the auth row. Purely presentational: every action and every derived
 * value is computed by App.tsx and passed in as props. */
export function AppSidebar({
  missionName,
  setMissionName,
  missionClient,
  setMissionClient,
  setPanelsHidden,
  setShowAbout,
  setCurrentPage,
  selfHosted,
  isAdmin,
  handleSave,
  saving,
  handleExport,
  exporting,
  handleImport,
  fileInputRef,
  handleDownloadReport,
  generatingReport,
  handleExportPhotogrammetryCsv,
  djiCloudEnabled,
  handleUploadToDjiCloud,
  uploadingToDjiCloud,
  handleUploadSegmentsToDjiCloud,
  uploadingSegmentsToDjiCloud,
  handleExportSegments,
  exportingSegments,
  handleSaveSegments,
  savingSegments,
  segmentsSummary,
  config,
  waypoints,
  flightStats,
  unitSystem,
  expandedSections,
  toggleSection,
  poiCount,
  obstacleCount,
  buildingCount,
  presetCount,
  mapRef,
  gravatarUrl,
  userEmail,
  token,
  setShowAccountMenu,
  logout,
  setShowAuthModal,
}: AppSidebarProps) {
  return (
    <div className="fixed inset-y-0 left-0 z-[1501] w-[85vw] max-w-88 shadow-2xl md:static md:z-auto md:w-88 md:max-w-none md:shadow-none flex flex-col border-r border-border bg-card shrink-0 tabular-nums">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <img src="/skyroute-icon.svg" alt="SkyRoute" className="h-5 w-5" />
            <span className="font-bold text-sm">SkyRoute</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPanelsHidden(true)}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title="Skrýt panely — mapa na celou obrazovku (Tab)"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
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
        <Input
          value={missionClient}
          onChange={(e) => setMissionClient(e.target.value)}
          className="h-7 text-xs mt-1.5"
          placeholder="Klient / zakázka (volitelné)"
          title="Přiřaďte misi ke klientovi nebo zakázce pro snadné třídění v Mých trasách"
        />
      </div>

      {/* Toolbar */}
      <div
        data-tour="save-toolbar"
        className="flex gap-1 p-2 border-b border-border"
      >
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
          onClick={handleDownloadReport}
          disabled={generatingReport || waypoints.length < 2}
          className="w-full text-xs h-7 border-[#00c2ff]/30 bg-[#00c2ff]/5 hover:bg-[#00c2ff]/15 hover:text-[#33cfff]"
          title={
            waypoints.length < 2
              ? "Pro report přidejte alespoň 2 body trasy"
              : "Stáhnout přehledný PDF report mise pro klienta (dron, statistiky letu, seznam bodů trasy)"
          }
        >
          <FileText className="h-3 w-3" />
          {generatingReport ? "..." : "Stáhnout PDF report"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportPhotogrammetryCsv}
          disabled={waypoints.length < 2}
          className="w-full text-xs h-7 border-[#00c2ff]/30 bg-[#00c2ff]/5 hover:bg-[#00c2ff]/15 hover:text-[#33cfff]"
          title={
            waypoints.length < 2
              ? "Pro export přidejte alespoň 2 body trasy"
              : "Stáhnout CSV se souřadnicemi plánovaných fotobodů pro import do Pix4D nebo Metashape"
          }
        >
          <FileSpreadsheet className="h-3 w-3" />
          Export pro Pix4D/Metashape (.csv)
        </Button>
        {djiCloudEnabled && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleUploadToDjiCloud}
            disabled={uploadingToDjiCloud || waypoints.length < 2}
            className="w-full text-xs h-7 border-[#00c2ff]/30 bg-[#00c2ff]/5 hover:bg-[#00c2ff]/15 hover:text-[#33cfff]"
            title={
              waypoints.length < 2
                ? "Pro nahrání přidejte alespoň 2 body trasy"
                : "Nahrát misi přímo do DJI Cloud — objeví se v Pilot 2 v záložce Cloud bez ručního přenášení souboru"
            }
          >
            <CloudUpload className="h-3 w-3" />
            {uploadingToDjiCloud ? "Nahrávám..." : "Nahrát do DJI Cloud"}
          </Button>
        )}
        {djiCloudEnabled && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleUploadSegmentsToDjiCloud}
            disabled={uploadingSegmentsToDjiCloud || waypoints.length < 2}
            className="w-full text-xs h-7 border-[#00c2ff]/30 bg-[#00c2ff]/5 hover:bg-[#00c2ff]/15 hover:text-[#33cfff]"
            title={
              waypoints.length < 2
                ? "Pro nahrání segmentů přidejte alespoň 2 body trasy"
                : "Rozdělit trasu na jednotlivé úseky (WP1→WP2, WP2→WP3, ...) a nahrát každý z nich jako samostatnou misi do DJI Cloud"
            }
          >
            <CloudUpload className="h-3 w-3" />
            {uploadingSegmentsToDjiCloud
              ? "Nahrávám segmenty..."
              : "Nahrát segmenty do DJI Cloud"}
          </Button>
        )}
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
      <div data-tour="sidebar-sections" className="flex-1 overflow-y-auto">
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
            Body zájmu (POI) ({poiCount})
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
            Překážky ({obstacleCount})
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
            Budovy ({buildingCount})
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
            Přednastavené šablony ({presetCount})
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

      {/* DJI Cloud fleet status (devices + HMS warnings) */}
      <DjiCloudOpsPanel />

      {/* DJI Cloud wayline library management */}
      <DjiWaylineLibraryPanel />

      {/* Elevation graph */}
      <ElevationGraph mapRef={mapRef} />

      {/* Footer stats with colored icons */}
      <div className="px-3 py-2 border-t border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          {(() => {
            const { photoCount, videoCount } = countCaptureActions(waypoints);
            const photoData = estimateMissionPhotoData(
              photoCount,
              config.payloadEnumValue,
            );
            return (
              <>
                {photoCount > 0 && (
                  <span
                    className="flex items-center gap-1 text-[11px]"
                    title={
                      photoData.estimatedSizeMB !== null
                        ? `Akce fotografování — odhad velikosti dat: ${formatDataSize(photoData.estimatedSizeMB)}`
                        : "Akce fotografování"
                    }
                  >
                    <Camera className="h-3 w-3 text-sky-400" />
                    <span className="text-sky-300 font-medium">
                      {photoCount}
                      {photoData.estimatedSizeMB !== null &&
                        ` (~${formatDataSize(photoData.estimatedSizeMB)})`}
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
  );
}
