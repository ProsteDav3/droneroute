import { useEffect } from "react";
import { useMissionStore } from "@/store/missionStore";
import { useMeasureStore } from "@/store/measureStore";
import { useAirspaceStore } from "@/store/airspaceStore";

interface UseGlobalKeyboardShortcutsArgs {
  setPanelsHidden: (value: boolean | ((prev: boolean) => boolean)) => void;
  setShowAbout: (show: boolean) => void;
}

/** App-wide single-key shortcuts (W/P/O/G/F/Z/Y/S/L/T/B/H/M/A/?/Escape/Tab/
 * Delete) — reads mutable store state imperatively via `.getState()` rather
 * than subscribing, since the handler only ever runs in response to a
 * keydown event and doesn't need to re-render when that state changes. */
export function useGlobalKeyboardShortcuts({
  setPanelsHidden,
  setShowAbout,
}: UseGlobalKeyboardShortcutsArgs) {
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
        case "z": {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            const { undo, redo } = useMissionStore.temporal.getState();
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
            return;
          }
          e.preventDefault();
          setTemplateMode(templateMode === "pencil" ? null : "pencil");
          break;
        }
        case "y":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            useMissionStore.temporal.getState().redo();
          }
          break;
        case "s":
          if (e.metaKey || e.ctrlKey) return; // don't intercept Cmd+S (save)
          e.preventDefault();
          setTemplateMode(templateMode === "solar" ? null : "solar");
          break;
        case "l":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setTemplateMode(templateMode === "corridor" ? null : "corridor");
          break;
        case "t":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setTemplateMode(templateMode === "turbine" ? null : "turbine");
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
        case "m": {
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          const measureStore = useMeasureStore.getState();
          if (!measureStore.isActive) {
            setIsAddingWaypoint(false);
            setIsAddingPoi(false);
            setIsDrawingObstacle(false);
            setIsDrawingBuilding(false);
            setTemplateMode(null);
          }
          measureStore.toggle();
          break;
        }
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
        case "?":
          e.preventDefault();
          setShowAbout(true);
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
        case "tab":
          // Only hijack Tab when nothing is focused (tag is null/BODY) —
          // otherwise this would break standard focus navigation through
          // buttons, links, and form fields anywhere else in the app.
          if (tag && tag !== "BODY") return;
          e.preventDefault();
          setPanelsHidden((hidden) => !hidden);
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
  }, [setPanelsHidden, setShowAbout]);
}
