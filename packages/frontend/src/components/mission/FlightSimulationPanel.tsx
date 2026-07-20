import { useEffect, useMemo, useRef } from "react";
import { Play, Pause, X, Clapperboard, Box, ArrowUp } from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import { useFlightSimulationStore } from "@/store/flightSimulationStore";
import {
  buildSimulationFrames,
  findFrameBracket,
  FRAMES_PER_SEGMENT,
} from "@/lib/flightSimulation";
import { formatFlightDuration } from "@/lib/flightStats";
import { Button } from "@/components/ui/button";

/**
 * Floating playback bar for the animated flythrough — mirrors the
 * `MissionProgressPanel` "overlay readout" style. Collapsed to a single
 * launch button until the user starts a simulation; expands into a
 * scrubber + play/pause once active. The actual camera frustum for the
 * current frame is rendered by `MapView` (see `frameToWaypoint`), driven
 * off the same `playheadS` this panel writes to `useFlightSimulationStore`.
 */
export function FlightSimulationPanel() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);
  const config = useMissionStore((s) => s.config);
  const templateMode = useMissionStore((s) => s.templateMode);
  const templateGroups = useMissionStore((s) => s.templateGroups);
  const editingTemplateGroupId = useMissionStore(
    (s) => s.editingTemplateGroupId,
  );
  const { isActive, isPlaying, playheadS, durationS, speed, cameraMode } =
    useFlightSimulationStore();
  const {
    start,
    stop,
    togglePlay,
    setPlayheadS,
    setSpeed,
    setCameraMode,
    advancePlayhead,
  } = useFlightSimulationStore.getState();

  const frames = useMemo(
    () =>
      buildSimulationFrames(
        waypoints,
        pois,
        FRAMES_PER_SEGMENT,
        config.autoFlightSpeed,
        templateGroups,
      ),
    [waypoints, pois, config.autoFlightSpeed, templateGroups],
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
      // `speed` is a real-time multiplier (1 = as fast as the drone would
      // actually fly), not a frames/sec rate — advancing continuously in
      // simulated seconds rather than in frame-count steps means the
      // camera glides exactly as fast as the mission's own real distances
      // and configured speeds dictate, not at a fixed pace unrelated to
      // either.
      advancePlayhead(elapsedS * speed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, speed, advancePlayhead]);

  if (waypoints.length < 2) return null;

  // TemplateConfigPanel renders bottom-center, inside Mapbox's own
  // `.mapboxgl-map` div, which the library gives its own `z-index: 0`
  // stacking context — no z-index on our side can make a sibling like this
  // panel outrank it. Hiding this panel whenever a template is being placed
  // or edited avoids the two silently overlapping and swallowing clicks
  // meant for the template panel's Apply/Cancel buttons.
  if (templateMode || editingTemplateGroupId) return null;

  if (!isActive) {
    const totalDurationS = frames.length ? frames[frames.length - 1].timeS : 0;
    return (
      <div className="absolute bottom-16 right-4 z-10">
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5 bg-background/95 shadow-lg"
          onClick={() => start(totalDurationS)}
          title="Spustit animovaný přelet trasy s náhledem záběru kamery"
        >
          <Clapperboard className="h-3.5 w-3.5" />
          Simulace letu
        </Button>
      </div>
    );
  }

  const { lower } = findFrameBracket(frames, playheadS);
  const currentFrame = frames[lower];
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
        max={Math.max(0, durationS)}
        step={0.01}
        value={playheadS}
        onChange={(e) => setPlayheadS(Number(e.target.value))}
        className="w-48 accent-[#00c2ff]"
        title="Posun v simulaci"
      />

      <span className="text-xs text-muted-foreground tabular-nums w-14 text-center">
        WP {legLabel}
      </span>

      <span className="text-xs text-muted-foreground tabular-nums">
        {formatFlightDuration(playheadS)} / {formatFlightDuration(durationS)}
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
        title="Rychlost přehrávání (1x = skutečná rychlost letu)"
      >
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={2}>2x</option>
        <option value={4}>4x</option>
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
