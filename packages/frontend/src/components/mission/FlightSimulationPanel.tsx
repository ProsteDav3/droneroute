import { useEffect, useMemo, useRef } from "react";
import { Play, Pause, X, Clapperboard, Box, ArrowUp } from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import { useFlightSimulationStore } from "@/store/flightSimulationStore";
import {
  buildSimulationFrames,
  FRAMES_PER_SEGMENT,
} from "@/lib/flightSimulation";
import { Button } from "@/components/ui/button";

/**
 * Floating playback bar for the animated flythrough — mirrors the
 * `MissionProgressPanel` "overlay readout" style. Collapsed to a single
 * launch button until the user starts a simulation; expands into a
 * scrubber + play/pause once active. The actual camera frustum for the
 * current frame is rendered by `MapView` (see `frameToWaypoint`), driven
 * off the same `frameIndex` this panel writes to `useFlightSimulationStore`.
 */
export function FlightSimulationPanel() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);
  const templateMode = useMissionStore((s) => s.templateMode);
  const editingTemplateGroupId = useMissionStore(
    (s) => s.editingTemplateGroupId,
  );
  const { isActive, isPlaying, frameIndex, frameCount, speed, cameraMode } =
    useFlightSimulationStore();
  const {
    start,
    stop,
    togglePlay,
    setFrameIndex,
    setSpeed,
    setCameraMode,
    advanceFrame,
  } = useFlightSimulationStore.getState();

  const frames = useMemo(
    () => buildSimulationFrames(waypoints, pois, FRAMES_PER_SEGMENT),
    [waypoints, pois],
  );

  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      lastTickRef.current = null;
      return;
    }
    const tick = (now: number) => {
      const last = lastTickRef.current;
      lastTickRef.current = now;
      const elapsedS = last === null ? 0 : (now - last) / 1000;
      // Advance roughly `speed` frames/sec regardless of the display's
      // actual frame rate, so playback speed doesn't depend on refresh rate.
      const framesToAdvance = Math.max(1, Math.round(elapsedS * speed));
      for (let i = 0; i < framesToAdvance; i++) advanceFrame();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, speed, advanceFrame]);

  if (waypoints.length < 2) return null;

  // TemplateConfigPanel renders bottom-center, inside Mapbox's own
  // `.mapboxgl-map` div, which the library gives its own `z-index: 0`
  // stacking context — no z-index on our side can make a sibling like this
  // panel outrank it. Hiding this panel whenever a template is being placed
  // or edited avoids the two silently overlapping and swallowing clicks
  // meant for the template panel's Apply/Cancel buttons.
  if (templateMode || editingTemplateGroupId) return null;

  if (!isActive) {
    return (
      <div className="absolute bottom-16 right-4 z-10">
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5 bg-background/95 shadow-lg"
          onClick={() => start(frames.length)}
          title="Spustit animovaný přelet trasy s náhledem záběru kamery"
        >
          <Clapperboard className="h-3.5 w-3.5" />
          Simulace letu
        </Button>
      </div>
    );
  }

  const currentFrame = frames[Math.min(frameIndex, frames.length - 1)];
  const legLabel = currentFrame
    ? `${currentFrame.afterWaypointIndex + 1} / ${waypoints.length}`
    : "";

  return (
    <div className="absolute bottom-16 right-4 z-10 flex items-center gap-3 rounded-lg bg-background/95 border border-border shadow-lg px-3 py-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={togglePlay}
        title={isPlaying ? "Pozastavit" : "Přehrát"}
      >
        {isPlaying ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
      </Button>

      <input
        type="range"
        min={0}
        max={Math.max(0, frameCount - 1)}
        value={frameIndex}
        onChange={(e) => setFrameIndex(Number(e.target.value))}
        className="w-48 accent-[#00c2ff]"
        title="Posun v simulaci"
      />

      <span className="text-xs text-muted-foreground tabular-nums w-14 text-center">
        WP {legLabel}
      </span>

      <div className="flex items-center rounded-md border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setCameraMode("top")}
          title="Pohled shora"
          className={`flex items-center gap-1 px-1.5 py-1 text-xs transition-colors ${
            cameraMode === "top"
              ? "bg-[#00c2ff] text-white"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <ArrowUp className="h-3 w-3" />
          Shora
        </button>
        <button
          type="button"
          onClick={() => setCameraMode("flythrough")}
          title="Reálný 3D přelet trasy"
          className={`flex items-center gap-1 px-1.5 py-1 text-xs transition-colors ${
            cameraMode === "flythrough"
              ? "bg-[#00c2ff] text-white"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <Box className="h-3 w-3" />
          3D let
        </button>
      </div>

      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="text-xs bg-transparent border border-border rounded px-1 py-0.5"
        title="Rychlost přehrávání"
      >
        <option value={2.5}>0.5x</option>
        <option value={5}>1x</option>
        <option value={10}>2x</option>
        <option value={20}>4x</option>
      </select>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={stop}
        title="Ukončit simulaci"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
