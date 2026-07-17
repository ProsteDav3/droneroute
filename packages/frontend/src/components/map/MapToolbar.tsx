import {
  MousePointerClick,
  Hand,
  Trash2,
  Crosshair,
  Orbit,
  Grid3X3,
  Building2,
  PenLine,
  ChevronDown,
  Triangle,
  Sun,
  Warehouse,
  Square,
  Spline,
  Cable,
  Fan,
  Ruler,
  ArrowLeftRight,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useMissionStore } from "@/store/missionStore";
import { useMeasureStore } from "@/store/measureStore";
import type { TemplateType } from "@/lib/templates";

const activeClass =
  "bg-primary text-primary-foreground ring-2 ring-primary/50 shadow-lg shadow-primary/20 hover:bg-primary/90";
const inactiveClass = "bg-background/90 backdrop-blur-sm";

const TEMPLATE_OPTIONS: {
  type: TemplateType;
  label: string;
  shortLabel: string;
  icon: typeof Orbit;
  description: string;
  key: string;
}[] = [
  {
    type: "orbit",
    label: "Orbit",
    shortLabel: "Orbit",
    icon: Orbit,
    description: "Kruh kolem bodu",
    key: "O",
  },
  {
    type: "grid",
    label: "Mřížkový průzkum",
    shortLabel: "Mřížka",
    icon: Grid3X3,
    description: "Skenování plochy po řádcích",
    key: "G",
  },
  {
    type: "facade",
    label: "Sken fasády",
    shortLabel: "Fasáda",
    icon: Building2,
    description: "Svislé skenování stěny",
    key: "F",
  },
  {
    type: "pencil",
    label: "Volná křivka",
    shortLabel: "Křivka",
    icon: PenLine,
    description: "Nakreslete trasu od ruky",
    key: "Z",
  },
  {
    type: "solar",
    label: "Solární panelový průzkum",
    shortLabel: "Solární",
    icon: Sun,
    description: "Obkreslete pole panelů a směr řad, oříznuté skenování",
    key: "S",
  },
  {
    type: "corridor",
    label: "Liniová stavba",
    shortLabel: "Liniová",
    icon: Cable,
    description: "Most, potrubí, vedení — souběžné průlety podél trasy",
    key: "L",
  },
  {
    type: "turbine",
    label: "Inspekce listů turbíny",
    shortLabel: "Turbína",
    icon: Fan,
    description: "Klikněte na rotor — obletí každý list turbíny zblízka",
    key: "T",
  },
];

export function MapToolbar() {
  const {
    isAddingWaypoint,
    isAddingPoi,
    isDrawingObstacle,
    isDrawingBuilding,
    buildingDrawMode,
    templateMode,
    setIsAddingWaypoint,
    setIsAddingPoi,
    setIsDrawingObstacle,
    setIsDrawingBuilding,
    setBuildingDrawMode,
    setTemplateMode,
    waypoints,
    pois,
    obstacles,
    buildings,
    clearMission,
    reverseWaypoints,
  } = useMissionStore();
  const isMeasuring = useMeasureStore((s) => s.isActive);
  const toggleMeasure = useMeasureStore((s) => s.toggle);

  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showTemplateMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowTemplateMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTemplateMenu]);

  const handleToggleMeasure = () => {
    if (!isMeasuring) {
      // Measuring is independent of mission content — exit whatever
      // mission-editing mode is active first so a click isn't interpreted
      // by two tools at once.
      setIsAddingWaypoint(false);
      setIsAddingPoi(false);
      setIsDrawingObstacle(false);
      setIsDrawingBuilding(false);
      setTemplateMode(null);
    }
    toggleMeasure();
  };

  const isPanning =
    !isAddingWaypoint &&
    !isAddingPoi &&
    !isDrawingObstacle &&
    !isDrawingBuilding &&
    !templateMode;

  return (
    <div
      data-tour="map-toolbar"
      className="absolute top-4 right-4 z-10 flex flex-col gap-2 min-w-[130px]"
    >
      <Button
        variant={isAddingWaypoint ? "default" : "outline"}
        size="sm"
        onClick={() => setIsAddingWaypoint(true)}
        title="Klikněte na mapu pro přidání bodů trasy (W)"
        className={`justify-between ${isAddingWaypoint ? activeClass : inactiveClass}`}
      >
        <span className="flex items-center gap-1.5">
          <MousePointerClick className="h-4 w-4" />
          <span className="text-xs">Přidat WP</span>
        </span>
        <kbd className="text-[10px] font-mono font-bold border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 rounded text-foreground/80">
          W
        </kbd>
      </Button>
      <Button
        variant={isAddingPoi ? "default" : "outline"}
        size="sm"
        onClick={() => setIsAddingPoi(true)}
        title="Klikněte na mapu pro přidání POI (P)"
        className={`justify-between ${isAddingPoi ? activeClass : inactiveClass}`}
      >
        <span className="flex items-center gap-1.5">
          <Crosshair className="h-4 w-4" />
          <span className="text-xs">Přidat POI</span>
        </span>
        <kbd className="text-[10px] font-mono font-bold border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 rounded text-foreground/80">
          P
        </kbd>
      </Button>
      <Button
        variant={isDrawingObstacle ? "default" : "outline"}
        size="sm"
        onClick={() => setIsDrawingObstacle(!isDrawingObstacle)}
        title="Nakreslit polygon překážky (B)"
        className={`justify-between ${isDrawingObstacle ? activeClass : inactiveClass}`}
      >
        <span className="flex items-center gap-1.5">
          <Triangle className="h-4 w-4" />
          <span className="text-xs">Překážka</span>
        </span>
        <kbd className="text-[10px] font-mono font-bold border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 rounded text-foreground/80">
          B
        </kbd>
      </Button>
      <Button
        variant={isDrawingBuilding ? "default" : "outline"}
        size="sm"
        onClick={() => setIsDrawingBuilding(!isDrawingBuilding)}
        title="Nakreslit půdorys budovy (H)"
        className={`justify-between ${isDrawingBuilding ? activeClass : inactiveClass}`}
      >
        <span className="flex items-center gap-1.5">
          <Warehouse className="h-4 w-4" />
          <span className="text-xs">Budova</span>
        </span>
        <kbd className="text-[10px] font-mono font-bold border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 rounded text-foreground/80">
          H
        </kbd>
      </Button>
      {isDrawingBuilding && (
        <div className="flex gap-1">
          <Button
            variant={buildingDrawMode === "rectangle" ? "default" : "outline"}
            size="sm"
            onClick={() => setBuildingDrawMode("rectangle")}
            title="Nakreslit obdélník ze 2 rohů"
            className={`flex-1 ${buildingDrawMode === "rectangle" ? activeClass : inactiveClass}`}
          >
            <Square className="h-3.5 w-3.5" />
            <span className="text-xs">Obdélník</span>
          </Button>
          <Button
            variant={buildingDrawMode === "polygon" ? "default" : "outline"}
            size="sm"
            onClick={() => setBuildingDrawMode("polygon")}
            title="Klikáním obkreslete nepravidelný půdorys"
            className={`flex-1 ${buildingDrawMode === "polygon" ? activeClass : inactiveClass}`}
          >
            <Spline className="h-3.5 w-3.5" />
            <span className="text-xs">Polygon</span>
          </Button>
        </div>
      )}

      <Button
        variant={isMeasuring ? "default" : "outline"}
        size="sm"
        onClick={handleToggleMeasure}
        title="Měřit vzdálenost a plochu na mapě, nezávisle na trase (M)"
        className={`justify-between ${isMeasuring ? activeClass : inactiveClass}`}
      >
        <span className="flex items-center gap-1.5">
          <Ruler className="h-4 w-4" />
          <span className="text-xs">Měřit</span>
        </span>
        <kbd className="text-[10px] font-mono font-bold border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 rounded text-foreground/80">
          M
        </kbd>
      </Button>

      {/* Template dropdown */}
      <div className="relative" ref={menuRef}>
        <Button
          variant={templateMode ? "default" : "outline"}
          size="sm"
          onClick={() => setShowTemplateMenu(!showTemplateMenu)}
          title="Vložit šablonu mise"
          className={`justify-between w-full ${templateMode ? activeClass : inactiveClass}`}
        >
          <span className="flex items-center gap-1.5">
            {templateMode === "orbit" ? (
              <Orbit className="h-4 w-4" />
            ) : templateMode === "grid" ? (
              <Grid3X3 className="h-4 w-4" />
            ) : templateMode === "facade" ? (
              <Building2 className="h-4 w-4" />
            ) : templateMode === "pencil" ? (
              <PenLine className="h-4 w-4" />
            ) : templateMode === "solar" ? (
              <Sun className="h-4 w-4" />
            ) : templateMode === "corridor" ? (
              <Cable className="h-4 w-4" />
            ) : templateMode === "turbine" ? (
              <Fan className="h-4 w-4" />
            ) : (
              <Grid3X3 className="h-4 w-4" />
            )}
            <span className="text-xs">
              {templateMode
                ? TEMPLATE_OPTIONS.find((t) => t.type === templateMode)
                    ?.shortLabel
                : "Šablona"}
            </span>
          </span>
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>

        {showTemplateMenu && (
          <div className="absolute top-full right-0 mt-1 w-48 bg-card/95 backdrop-blur-sm border border-border rounded-md shadow-lg overflow-hidden z-50">
            {TEMPLATE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isActive = templateMode === opt.type;
              return (
                <button
                  key={opt.type}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors ${isActive ? "bg-accent text-accent-foreground" : ""}`}
                  onClick={() => {
                    setTemplateMode(opt.type);
                    setShowTemplateMenu(false);
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <div className="text-left flex-1">
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {opt.description}
                    </div>
                  </div>
                  <kbd className="text-[10px] font-mono font-bold border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 rounded text-foreground/80 shrink-0">
                    {opt.key}
                  </kbd>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Button
        variant={isPanning ? "default" : "outline"}
        size="sm"
        onClick={() => {
          setIsAddingWaypoint(false);
          setIsAddingPoi(false);
          setIsDrawingObstacle(false);
          setIsDrawingBuilding(false);
          setTemplateMode(null);
        }}
        title="Posun / výběr (Esc)"
        className={`justify-between ${isPanning ? activeClass : inactiveClass}`}
      >
        <span className="flex items-center gap-1.5">
          <Hand className="h-4 w-4" />
          <span className="text-xs">Posun</span>
        </span>
        <kbd className="text-[10px] font-mono font-bold border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 rounded text-foreground/80">
          Esc
        </kbd>
      </Button>
      {waypoints.length >= 2 && (
        <Button
          variant="outline"
          size="sm"
          onClick={reverseWaypoints}
          title="Obrátit směr trasy — poslední bod se stane prvním (u časosběrů se hodí letět tam-zpět)"
          className="bg-background/90 backdrop-blur-sm"
        >
          <ArrowLeftRight className="h-4 w-4" />
          <span className="text-xs">Obrátit trasu</span>
        </Button>
      )}
      {(waypoints.length > 0 ||
        pois.length > 0 ||
        obstacles.length > 0 ||
        buildings.length > 0) && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (confirm("Smazat všechny body trasy, POI, překážky a budovy?"))
              clearMission();
          }}
          title="Smazat všechny body trasy, POI, překážky a budovy"
          className="bg-background/90 backdrop-blur-sm text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          <span className="text-xs">Smazat vše</span>
        </Button>
      )}
    </div>
  );
}
