import { useState, useRef, useEffect, useMemo } from "react";
import {
  MapPin,
  X,
  GripVertical,
  Settings,
  ArrowUp,
  Gauge,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMissionStore } from "@/store/missionStore";
import type { SelectionMode } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { useConfigStore } from "@/store/configStore";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";
import { formatHeight, formatSpeed } from "@/lib/units";
import { computeMissionProgress } from "@/lib/missionProgress";
import {
  estimateWaypointArrivalTimes,
  formatFlightDuration,
} from "@/lib/flightStats";
import { WaypointEditorInline } from "./WaypointEditor";

export function WaypointList() {
  const {
    waypoints,
    selectedWaypointIndices,
    selectWaypoint,
    removeWaypoint,
    reorderWaypoints,
    updateWaypoint,
    config,
  } = useMissionStore();
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  // Estimated time-from-launch at which the aircraft reaches each waypoint
  // — shown as a small badge next to height/speed so a long or complex
  // mission's pacing is visible at a glance without opening the PDF report.
  const arrivalTimes = useMemo(
    () => estimateWaypointArrivalTimes(waypoints, config.autoFlightSpeed),
    [waypoints, config.autoFlightSpeed],
  );
  const djiCloudEnabled = useConfigStore((s) => s.djiCloudEnabled);
  const telemetry = useDjiCloudOpsStore((s) => s.telemetry);

  // Cross-references the live DJI Cloud telemetry stream against this
  // mission's own waypoints to highlight which ones the aircraft has
  // already flown past — see lib/missionProgress.ts for the "nearest point
  // on path" heuristic and its single-aircraft assumption.
  const flownWaypointIndex = useMemo(() => {
    if (!djiCloudEnabled) return -1;
    const flying = Object.values(telemetry).find(
      (d) =>
        d.online &&
        typeof d.latitude === "number" &&
        typeof d.longitude === "number",
    );
    if (!flying) return -1;
    const progress = computeMissionProgress(
      waypoints,
      { lat: flying.latitude!, lng: flying.longitude! },
      flying.horizontalSpeed,
    );
    return progress?.flownWaypointIndex ?? -1;
  }, [djiCloudEnabled, telemetry, waypoints]);

  const [expandedEditor, setExpandedEditor] = useState<number | null>(null);
  const [editingName, setEditingName] = useState<number | null>(null);

  // When exactly one waypoint is selected (e.g. by clicking on the map), expand its editor
  useEffect(() => {
    if (selectedWaypointIndices.size === 1) {
      const [index] = selectedWaypointIndices;
      setExpandedEditor(index);
    }
  }, [selectedWaypointIndices]);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragItemRef = useRef<number | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  if (waypoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <MapPin className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">Zatím žádné body trasy</p>
        <p className="text-xs mt-1">Klikněte na mapu pro přidání bodů trasy</p>
      </div>
    );
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragItemRef.current = index;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = dragItemRef.current;
    if (fromIndex !== null && fromIndex !== toIndex) {
      reorderWaypoints(fromIndex, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragItemRef.current = null;
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
    dragItemRef.current = null;
  };

  const toggleEditor = (wpIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedEditor((prev) => (prev === wpIndex ? null : wpIndex));
  };

  const startRename = (wpIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingName(wpIndex);
    // Focus the input after render
    setTimeout(() => nameInputRef.current?.select(), 0);
  };

  const commitRename = (wpIndex: number, value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      updateWaypoint(wpIndex, { name: trimmed });
    }
    setEditingName(null);
  };

  const handleClick = (e: React.MouseEvent, wpIndex: number) => {
    let mode: SelectionMode = "replace";
    if (e.ctrlKey || e.metaKey) {
      mode = "toggle";
    } else if (e.shiftKey) {
      mode = "range";
    }
    selectWaypoint(wpIndex, mode);
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      {waypoints.map((wp, i) => {
        const isSelected = selectedWaypointIndices.has(wp.index);
        const isDragging = dragIndex === i;
        const isDragOver = dragOverIndex === i;
        const isEditorOpen =
          expandedEditor === wp.index && selectedWaypointIndices.size <= 1;
        const isRenaming = editingName === wp.index;
        const isFlown = wp.index <= flownWaypointIndex;

        return (
          <div key={wp.index}>
            <div
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                isDragging
                  ? "opacity-40"
                  : isDragOver
                    ? "border-t-2 border-primary"
                    : isSelected
                      ? "bg-primary/20 border border-primary/40"
                      : isFlown
                        ? "opacity-60 hover:bg-secondary border border-transparent"
                        : "hover:bg-secondary border border-transparent"
              }`}
              onClick={(e) => handleClick(e, wp.index)}
              draggable
              onDragStart={(e) => handleDragStart(e, i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, i)}
              onDragEnd={handleDragEnd}
            >
              <span title="Přetažením přeuspořádáte">
                <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
              </span>
              <Badge
                variant={isSelected ? "default" : "secondary"}
                className={`text-[10px] px-1.5 py-0 ${isFlown ? "bg-emerald-600/80 text-white" : ""}`}
                title={isFlown ? "Bod trasy je za dronem" : undefined}
              >
                {isFlown ? (
                  <CheckCircle2 className="h-2.5 w-2.5" />
                ) : (
                  wp.index + 1
                )}
              </Badge>
              <div className="flex-1 min-w-0">
                {isRenaming ? (
                  <input
                    ref={nameInputRef}
                    className="text-xs font-medium bg-transparent border-b border-primary outline-none w-full py-0"
                    defaultValue={wp.name}
                    autoFocus
                    onBlur={(e) => commitRename(wp.index, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        commitRename(wp.index, e.currentTarget.value);
                      if (e.key === "Escape") setEditingName(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div
                    className="text-xs font-medium truncate cursor-text hover:text-primary transition-colors"
                    onDoubleClick={(e) => startRename(wp.index, e)}
                    title="Přejmenujte dvojklikem"
                  >
                    {wp.name || `Bod trasy ${wp.index + 1}`}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                  <span className="flex items-center gap-0.5">
                    <ArrowUp className="h-2.5 w-2.5" />
                    {formatHeight(wp.height, unitSystem)}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Gauge className="h-2.5 w-2.5" />
                    {formatSpeed(wp.speed, unitSystem)}
                  </span>
                  {i > 0 && (
                    <span
                      className="flex items-center gap-0.5"
                      title="Odhadovaný čas doletu od startu"
                    >
                      <Clock className="h-2.5 w-2.5" />
                      {formatFlightDuration(arrivalTimes[i] ?? 0)}
                    </span>
                  )}
                </div>
              </div>
              {wp.actions.length > 0 && (
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {wp.actions.length}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className={`h-5 w-5 shrink-0 ${
                  isEditorOpen
                    ? "text-primary hover:text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={(e) => toggleEditor(wp.index, e)}
                title="Upravit nastavení bodu trasy"
              >
                <Settings className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  removeWaypoint(wp.index);
                }}
                title="Odebrat bod trasy"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            {isEditorOpen && (
              <div className="ml-4 mr-1 mt-1 mb-2 border-l-2 border-blue-400/30 bg-blue-500/5 rounded-r-md">
                <WaypointEditorInline waypointIndex={wp.index} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
