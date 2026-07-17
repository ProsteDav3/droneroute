import { useRef, useEffect, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Check, X, MapPin, Save } from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { useAuthStore } from "@/store/authStore";
import { useTemplatePresetsStore } from "@/store/templatePresetsStore";
import { heightModeLabel } from "@/lib/units";
import {
  type TemplateType,
  type OrbitParams,
  type GridParams,
  type FacadeParams,
  type PencilParams,
  type SolarParams,
  type CorridorParams,
  type TurbineParams,
} from "@/lib/templates";
import { WIDE_CAMERA_FOV } from "@/lib/solarCamera";
import type { PointOfInterest } from "@droneroute/shared";
import { OrbitFields } from "./template-config/OrbitFields";
import { GridFields } from "./template-config/GridFields";
import { FacadeFields } from "./template-config/FacadeFields";
import { PencilFields } from "./template-config/PencilFields";
import { CorridorFields } from "./template-config/CorridorFields";
import { TurbineFields } from "./template-config/TurbineFields";
import { SolarFields } from "./template-config/SolarFields";

interface TemplateConfigPanelProps {
  type: TemplateType;
  orbitParams?: OrbitParams | null;
  gridParams?: GridParams | null;
  facadeParams?: FacadeParams | null;
  pencilParams?: PencilParams | null;
  solarParams?: SolarParams | null;
  corridorParams?: CorridorParams | null;
  turbineParams?: TurbineParams | null;
  onOrbitChange?: (params: OrbitParams) => void;
  onGridChange?: (params: GridParams) => void;
  onFacadeChange?: (params: FacadeParams) => void;
  onPencilChange?: (params: PencilParams) => void;
  onSolarChange?: (params: SolarParams) => void;
  onCorridorChange?: (params: CorridorParams) => void;
  onTurbineChange?: (params: TurbineParams) => void;
  onApply: () => void;
  onCancel: () => void;
  waypointCount: number;
  pois?: PointOfInterest[];
}

export function TemplateConfigPanel({
  type,
  orbitParams,
  gridParams,
  facadeParams,
  pencilParams,
  solarParams,
  corridorParams,
  turbineParams,
  onOrbitChange,
  onGridChange,
  onFacadeChange,
  onPencilChange,
  onSolarChange,
  onCorridorChange,
  onTurbineChange,
  onApply,
  onCancel,
  waypointCount,
  pois,
}: TemplateConfigPanelProps) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const setFlyToTarget = useMissionStore((s) => s.setFlyToTarget);
  const heightMode = useMissionStore((s) => s.config.heightMode);
  const payloadEnumValue = useMissionStore((s) => s.config.payloadEnumValue);
  const wideFov = WIDE_CAMERA_FOV[payloadEnumValue];
  const heightModeText = heightModeLabel(heightMode);
  const title =
    type === "orbit"
      ? "Orbit"
      : type === "grid"
        ? "Mřížkový průzkum"
        : type === "facade"
          ? "Sken fasády"
          : type === "solar"
            ? "Solární panelový průzkum"
            : type === "corridor"
              ? "Liniová stavba"
              : type === "turbine"
                ? "Inspekce listů turbíny"
                : "Volná křivka";
  const description =
    type === "orbit"
      ? "Kruhová letová trasa kolem středového bodu. Upravte radius, počet bodů a zapněte POI, aby kamera zůstala zaměřená na střed. Nastavte koncový úhel pod 360° pro otevřený oblouk mezi počátečním a koncovým směrem místo celého kruhu."
      : type === "grid"
        ? "Cik-cak vzor pro systematické pokrytí plochy. Nastavte rozestup řádků pro překryv a rotaci pro zarovnání s terénem."
        : type === "facade"
          ? "Svislý skenovací vzor podél stěny nebo fasády budovy. Nastavte odstup od stěny, rozsah výšky a hustotu mřížky pro úplné pokrytí."
          : type === "solar"
            ? "Cik-cak trasa oříznutá přesně podle tvaru, který jste obkreslili kolem pole panelů — dron nikdy nepřeletí za jeho okraje. Letové řádky vedou pod úhlem, který jste nastavili nakreslením referenční čáry podél řady panelů."
            : type === "corridor"
              ? "Nakreslete osu liniové stavby (most, potrubí, vedení, silnice, železnice) — dron proletí souběžné trasy posunuté do stran, užitečné pro prohlídku z více úhlů."
              : type === "turbine"
                ? "Klikněte na rotor turbíny — dron obletí zblízka každý list od kořene ke špičce, s kamerou mířící zpět na rotor."
                : "Letová trasa nakreslená od ruky na mapě. Upravte počet bodů trasy pro řízení toho, jak přesně se trasa dodrží.";

  // Must stay in sync with MAX_WAYPOINTS in
  // packages/backend/src/services/missionValidation.ts — surfaced here so
  // a template that would exceed the mission's hard waypoint limit (e.g. a
  // large solar array with tight line/photo spacing) is caught before
  // Apply, not at save/export time.
  const MAX_WAYPOINTS = 5000;
  const exceedsWaypointLimit = waypointCount > MAX_WAYPOINTS;

  // "Save as preset" — reusable across missions, e.g. the same recurring
  // orbit around a fixed site. Works generically for whichever template
  // type/params this panel currently shows.
  const currentParams =
    orbitParams ||
    gridParams ||
    facadeParams ||
    pencilParams ||
    solarParams ||
    corridorParams ||
    turbineParams;
  const token = useAuthStore((s) => s.token);
  const createPreset = useTemplatePresetsStore((s) => s.createPreset);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetSaveInFlight, setPresetSaveInFlight] = useState(false);

  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name || !currentParams) return;
    setPresetSaveInFlight(true);
    try {
      await createPreset(
        name,
        type,
        currentParams as unknown as Record<string, unknown>,
      );
      toast.success(`Šablona "${name}" byla uložena`);
      setSavingPreset(false);
      setPresetName("");
    } catch (err: any) {
      toast.error(`Uložení šablony se nezdařilo: ${err.message}`);
    } finally {
      setPresetSaveInFlight(false);
    }
  };

  // Stop all pointer/keyboard/wheel events from reaching Leaflet (native DOM level)
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    const events = [
      "mousedown",
      "mouseup",
      "dblclick",
      "wheel",
      "keydown",
      "keyup",
      "pointerdown",
      "pointerup",
      "touchstart",
      "touchend",
    ];
    for (const evt of events) el.addEventListener(evt, stop);
    return () => {
      for (const evt of events) el.removeEventListener(evt, stop);
    };
  }, []);

  // Drag-to-reposition, grabbed by the title/badge area of the header (not
  // the close button). The panel defaults to bottom-center over the map,
  // which can sit right on top of the area the user is working on — this
  // lets it be moved out of the way instead of forcing a zoom-out to see
  // underneath it. Plain native listeners (not React's onPointerDown), same
  // as the stopPropagation effect above, since a native pointerdown fired on
  // this panel never reaches React's root-delegated listener once
  // `stop()` above calls stopPropagation on it.
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const [dragPosition, setDragPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    const handle = dragHandleRef.current;
    const panel = panelRef.current;
    if (!handle || !panel) return;

    // Tracks the in-progress drag's own listeners so they can be torn down
    // if the panel unmounts mid-drag (e.g. Apply/Cancel fires while the
    // pointer is still down) — otherwise they'd linger on `window` until
    // the next pointerup, harmlessly but needlessly.
    let activeDrag: {
      move: (e: PointerEvent) => void;
      up: () => void;
    } | null = null;

    const handlePointerDown = (e: PointerEvent) => {
      // The whole header row is the drag handle, but the close button
      // lives inside it too — let its own click work normally instead of
      // starting a drag underneath it.
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      // Track via movementX/movementY (per-event relative deltas), not
      // absolute clientX/clientY — a real machine hit a browser-level bug
      // where clientX jumped far more than the actual mouse movement under
      // 125% Windows display scaling (devicePixelRatio reported as 1).
      // Only the drag's starting position comes from getBoundingClientRect(),
      // which is unaffected by that clientX inconsistency.
      const panelRect = panel.getBoundingClientRect();
      let currentLeft = panelRect.left;
      let currentTop = panelRect.top;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        currentLeft += moveEvent.movementX;
        currentTop += moveEvent.movementY;
        // Clamp the accumulator itself, not just what gets rendered —
        // otherwise it keeps summing past the visual edge while the panel
        // looks stuck there, and reversing direction wouldn't move it again
        // until the accumulator drifted back past the boundary.
        const maxLeft = Math.max(window.innerWidth - panel.offsetWidth, 0);
        const maxTop = Math.max(window.innerHeight - panel.offsetHeight, 0);
        currentLeft = Math.min(Math.max(currentLeft, 0), maxLeft);
        currentTop = Math.min(Math.max(currentTop, 0), maxTop);
        setDragPosition({ left: currentLeft, top: currentTop });
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp, true);
        window.removeEventListener("pointercancel", handlePointerUp, true);
        activeDrag = null;
      };

      activeDrag = { move: handlePointerMove, up: handlePointerUp };
      window.addEventListener("pointermove", handlePointerMove);
      // Capture phase, not bubble: the stopPropagation effect above (guarding
      // Leaflet/Mapbox) calls stopPropagation on this same panel for
      // pointerup during the BUBBLE phase, which — since the pointer is
      // almost always released back over the panel itself while dragging —
      // would otherwise stop this pointerup from ever reaching a
      // bubble-phase window listener, leaving the drag stuck following the
      // cursor forever with no way to "let go" short of unmounting the
      // whole panel. A capture-phase listener runs top-down, before the
      // event ever reaches the panel and before that stopPropagation call.
      window.addEventListener("pointerup", handlePointerUp, true);
      window.addEventListener("pointercancel", handlePointerUp, true);
    };

    handle.addEventListener("pointerdown", handlePointerDown);
    return () => {
      handle.removeEventListener("pointerdown", handlePointerDown);
      if (activeDrag) {
        window.removeEventListener("pointermove", activeDrag.move);
        window.removeEventListener("pointerup", activeDrag.up, true);
        window.removeEventListener("pointercancel", activeDrag.up, true);
      }
    };
  }, []);

  // Root cause of the drag-jump bug, confirmed via the diagnostic overlay:
  // Tailwind's `-translate-x-1/2` utility sets the `transform` property via
  // its own class, and an inline `style.transform = "none"` did NOT
  // override it (measured actual rendered position was consistently offset
  // from the intended state position by exactly half the panel's own
  // width — the signature of translateX(-50%) still being applied on top
  // of the new `left`). Rather than fight that specificity/cascade
  // question, the default-position classes (`bottom-4 left-1/2
  // -translate-x-1/2`) are simply omitted from the className once dragging
  // has set an explicit position, so there's no competing rule to override
  // in the first place.
  const positionStyle: CSSProperties = dragPosition
    ? {
        position: "fixed",
        left: dragPosition.left,
        top: dragPosition.top,
      }
    : {};
  const positionClassName = dragPosition
    ? ""
    : "absolute bottom-4 left-1/2 -translate-x-1/2";

  return (
    <div
      ref={panelRef}
      style={positionStyle}
      className={`${positionClassName} z-20 bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl p-3 min-w-[320px] max-w-[420px]`}
    >
      {/* Header — the whole row is the drag handle (see the pointerdown
          guard below that excludes the close button specifically) */}
      <div
        ref={dragHandleRef}
        className="flex items-center justify-between mb-1 cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: "none" }}
        title="Přetažením přesunete panel"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
            {title}
          </span>
          <Badge
            variant={exceedsWaypointLimit ? "destructive" : "secondary"}
            className="text-[10px] gap-1"
          >
            <MapPin className="h-3 w-3" />
            {waypointCount}{" "}
            {waypointCount === 1
              ? "bod trasy"
              : waypointCount >= 2 && waypointCount <= 4
                ? "body trasy"
                : "bodů trasy"}
          </Badge>
        </div>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground mb-3">{description}</p>

      {type === "orbit" && orbitParams && onOrbitChange && (
        <OrbitFields
          orbitParams={orbitParams}
          onOrbitChange={onOrbitChange}
          unitSystem={unitSystem}
          wideFov={wideFov}
          heightModeText={heightModeText}
          setFlyToTarget={setFlyToTarget}
        />
      )}

      {type === "grid" && gridParams && onGridChange && (
        <GridFields
          gridParams={gridParams}
          onGridChange={onGridChange}
          unitSystem={unitSystem}
          wideFov={wideFov}
          payloadEnumValue={payloadEnumValue}
        />
      )}

      {type === "facade" && facadeParams && onFacadeChange && (
        <FacadeFields
          facadeParams={facadeParams}
          onFacadeChange={onFacadeChange}
          unitSystem={unitSystem}
          payloadEnumValue={payloadEnumValue}
        />
      )}

      {type === "pencil" && pencilParams && onPencilChange && (
        <PencilFields
          pencilParams={pencilParams}
          onPencilChange={onPencilChange}
          unitSystem={unitSystem}
          pois={pois}
        />
      )}

      {type === "corridor" && corridorParams && onCorridorChange && (
        <CorridorFields
          corridorParams={corridorParams}
          onCorridorChange={onCorridorChange}
          unitSystem={unitSystem}
        />
      )}

      {type === "turbine" && turbineParams && onTurbineChange && (
        <TurbineFields
          turbineParams={turbineParams}
          onTurbineChange={onTurbineChange}
          unitSystem={unitSystem}
        />
      )}

      {type === "solar" && solarParams && onSolarChange && (
        <SolarFields
          solarParams={solarParams}
          onSolarChange={onSolarChange}
          unitSystem={unitSystem}
          payloadEnumValue={payloadEnumValue}
          heightModeText={heightModeText}
        />
      )}

      {exceedsWaypointLimit && (
        <div className="text-[10px] text-destructive mb-2">
          Tímto by vzniklo {waypointCount} bodů trasy, nad limit mise{" "}
          {MAX_WAYPOINTS} — před použitím zvyšte rozestup.
        </div>
      )}

      {/* Save as reusable preset */}
      {currentParams &&
        (savingPreset ? (
          <div className="flex items-center gap-1.5 mb-2">
            <Input
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePreset();
                if (e.key === "Escape") {
                  setSavingPreset(false);
                  setPresetName("");
                }
              }}
              placeholder="Název šablony"
              className="h-7 text-xs flex-1"
            />
            <Button
              size="icon"
              className="h-7 w-7 shrink-0"
              disabled={!presetName.trim() || presetSaveInFlight}
              onClick={handleSavePreset}
              title="Uložit šablonu"
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => {
                setSavingPreset(false);
                setPresetName("");
              }}
              title="Zrušit"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!token}
            title={
              token
                ? "Uložit aktuální nastavení jako znovupoužitelnou šablonu"
                : "Přihlaste se pro ukládání šablon"
            }
            onClick={() => setSavingPreset(true)}
            className="w-full h-7 text-xs mb-2"
          >
            <Save className="h-3 w-3 mr-1" />
            Uložit jako šablonu
          </Button>
        ))}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onApply}
          disabled={exceedsWaypointLimit}
          className="flex-1 h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
        >
          <Check className="h-3 w-3 mr-1" />
          Použít
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="h-7 text-xs"
        >
          Zrušit
        </Button>
      </div>
    </div>
  );
}
