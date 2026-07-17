import { useRef, useState, useCallback, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import type { SelectionMode } from "@/store/missionStore";

const GRAPH_HEIGHT = 100;
const PAD_TOP = 14;
const PAD_BOTTOM = 14;
const PAD_LEFT = 28;
const PAD_RIGHT = 28;
const CIRCLE_RADIUS = 11;
const CIRCLE_RADIUS_ACTIVE = 13;
const MIN_HEIGHT = 2;
const MAX_HEIGHT = 500;
const MIN_SPACING = 44;

const LS_KEY = "elevationChartOpen";

export function ElevationGraph() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const selectedIndices = useMissionStore((s) => s.selectedWaypointIndices);
  const updateWaypoint = useMissionStore((s) => s.updateWaypoint);
  const selectWaypoint = useMissionStore((s) => s.selectWaypoint);

  const svgRef = useRef<SVGSVGElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  // Height while a drag is in progress, shown locally without touching the
  // store — only committed via updateWaypoint on pointer-up. Committing on
  // every pointermove instead would push one undo-history entry per pixel
  // of drag (zundo has no way to know a chain of moves is a single gesture).
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const pointerStart = useRef<{
    x: number;
    y: number;
    index: number;
    event: React.PointerEvent;
  } | null>(null);
  const didDrag = useRef(false);
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(LS_KEY) !== "false",
  );

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(LS_KEY, String(next));
      return next;
    });
  }, []);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // SVG width: ensure minimum spacing between waypoints
  const effectiveWidth = containerWidth || 320;
  const neededWidth =
    waypoints.length <= 1
      ? effectiveWidth
      : PAD_LEFT + PAD_RIGHT + (waypoints.length - 1) * MIN_SPACING;
  const svgWidth = Math.max(effectiveWidth, neededWidth);

  const plotW = svgWidth - PAD_LEFT - PAD_RIGHT;
  const plotH = GRAPH_HEIGHT - PAD_TOP - PAD_BOTTOM;

  // Compute Y scale — folds in the in-progress dragHeight (not yet committed
  // to the store) so the axis keeps rescaling live while dragging past the
  // current range, same as before this became a local-state drag.
  const heights = waypoints.map((wp) =>
    draggingIndex === wp.index && dragHeight !== null ? dragHeight : wp.height,
  );
  const rawMin = Math.min(...heights);
  const rawMax = Math.max(...heights);
  const spread = rawMax - rawMin;
  const yPad = Math.max(spread * 0.25, 10);
  const yMin = Math.max(0, Math.floor(rawMin - yPad));
  const yMax = Math.ceil(rawMax + yPad);

  const toX = useCallback(
    (i: number) => {
      if (waypoints.length === 1) return PAD_LEFT + plotW / 2;
      return PAD_LEFT + (i / (waypoints.length - 1)) * plotW;
    },
    [waypoints.length, plotW],
  );

  const toY = useCallback(
    (h: number) => {
      if (yMax === yMin) return PAD_TOP + plotH / 2;
      return PAD_TOP + plotH - ((h - yMin) / (yMax - yMin)) * plotH;
    },
    [yMin, yMax, plotH],
  );

  const fromY = useCallback(
    (py: number) => {
      if (yMax === yMin) return rawMin;
      const h = yMin + ((PAD_TOP + plotH - py) / plotH) * (yMax - yMin);
      return Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h)));
    },
    [yMin, yMax, plotH, rawMin],
  );

  // Drag handlers (with click-to-select detection)
  const CLICK_THRESHOLD = 3; // px — below this, treat as click

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, wpIndex: number) => {
      e.preventDefault();
      (e.target as SVGElement).setPointerCapture(e.pointerId);
      pointerStart.current = {
        x: e.clientX,
        y: e.clientY,
        index: wpIndex,
        event: e,
      };
      didDrag.current = false;
      setDraggingIndex(wpIndex);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingIndex === null) return;
      const svg = svgRef.current;
      if (!svg) return;

      // Check if pointer moved enough to be a drag
      if (pointerStart.current && !didDrag.current) {
        const dx = e.clientX - pointerStart.current.x;
        const dy = e.clientY - pointerStart.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < CLICK_THRESHOLD) return;
        didDrag.current = true;
      }

      const rect = svg.getBoundingClientRect();
      const py = e.clientY - rect.top;
      setDragHeight(fromY(py));
    },
    [draggingIndex, fromY],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (draggingIndex !== null && pointerStart.current && !didDrag.current) {
        // This was a click, not a drag — select the waypoint
        const nativeEvent = e.nativeEvent;
        let mode: SelectionMode = "replace";
        if (nativeEvent.ctrlKey || nativeEvent.metaKey) {
          mode = "toggle";
        } else if (nativeEvent.shiftKey) {
          mode = "range";
        }
        selectWaypoint(pointerStart.current.index, mode);
      } else if (draggingIndex !== null && dragHeight !== null) {
        updateWaypoint(draggingIndex, { height: dragHeight });
      }
      setDraggingIndex(null);
      setDragHeight(null);
      pointerStart.current = null;
      didDrag.current = false;
    },
    [draggingIndex, dragHeight, selectWaypoint, updateWaypoint],
  );

  const handlePointerLeave = useCallback(() => {
    if (draggingIndex !== null && dragHeight !== null) {
      updateWaypoint(draggingIndex, { height: dragHeight });
    }
    setDraggingIndex(null);
    setDragHeight(null);
    pointerStart.current = null;
    didDrag.current = false;
  }, [draggingIndex, dragHeight, updateWaypoint]);

  if (waypoints.length === 0) {
    return (
      <div
        ref={containerRef}
        className="border-t border-border bg-background/50"
      >
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors"
          onClick={toggleExpanded}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Výškový profil
        </button>
        {expanded && (
          <div className="px-3 py-4 text-[10px] text-muted-foreground text-center">
            Přidejte body trasy pro zobrazení výškového profilu
          </div>
        )}
      </div>
    );
  }

  // While dragging, show the pending height locally instead of the store's
  // (not-yet-committed) value — see the dragHeight state above.
  const displayHeight = (wp: (typeof waypoints)[number]) =>
    draggingIndex === wp.index && dragHeight !== null ? dragHeight : wp.height;

  // Compute edge-to-edge line segments between circles
  const edgeSegments: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const ax = toX(i);
    const ay = toY(displayHeight(waypoints[i]));
    const bx = toX(i + 1);
    const by = toY(displayHeight(waypoints[i + 1]));
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < CIRCLE_RADIUS * 2 + 4) continue;
    const nx = dx / dist;
    const ny = dy / dist;
    const rA =
      draggingIndex === waypoints[i].index
        ? CIRCLE_RADIUS_ACTIVE
        : CIRCLE_RADIUS;
    const rB =
      draggingIndex === waypoints[i + 1].index
        ? CIRCLE_RADIUS_ACTIVE
        : CIRCLE_RADIUS;
    edgeSegments.push({
      x1: ax + nx * (rA + 2),
      y1: ay + ny * (rA + 2),
      x2: bx - nx * (rB + 2),
      y2: by - ny * (rB + 2),
    });
  }

  return (
    <div ref={containerRef} className="border-t border-border bg-background/50">
      {/* Pinned header — always visible */}
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors"
        onClick={toggleExpanded}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Elevation chart
      </button>

      {/* Collapsible body */}
      {expanded && (
        <div
          className="overflow-x-auto"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "#334155 transparent",
          }}
        >
          <svg
            ref={svgRef}
            width={svgWidth}
            height={GRAPH_HEIGHT}
            className="select-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
          >
            {/* Full-pane background grid */}
            {(() => {
              const lines = [];
              // Horizontal grid lines
              const hCount = 5;
              for (let i = 0; i <= hCount; i++) {
                const y = (i / hCount) * GRAPH_HEIGHT;
                lines.push(
                  <line
                    key={`h-${i}`}
                    x1={0}
                    y1={y}
                    x2={svgWidth}
                    y2={y}
                    stroke="#475569"
                    strokeWidth={0.5}
                    opacity={0.3}
                  />,
                );
              }
              // Vertical grid lines (every ~40px)
              const vStep = 40;
              for (let x = 0; x <= svgWidth; x += vStep) {
                lines.push(
                  <line
                    key={`v-${x}`}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={GRAPH_HEIGHT}
                    stroke="#475569"
                    strokeWidth={0.5}
                    opacity={0.3}
                  />,
                );
              }
              return lines;
            })()}

            {/* Edge-to-edge dotted line segments between circles */}
            {edgeSegments.map((seg, i) => (
              <line
                key={`seg-${i}`}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke="#33cfff"
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray="4,4"
                opacity={0.7}
              />
            ))}

            {/* Nodes */}
            {waypoints.map((wp, i) => {
              const cx = toX(i);
              const cy = toY(displayHeight(wp));
              const isSelected = selectedIndices.has(wp.index);
              const isDragging = draggingIndex === wp.index;
              const r = isDragging ? CIRCLE_RADIUS_ACTIVE : CIRCLE_RADIUS;

              return (
                <g key={wp.index}>
                  <title>Přetažením upravíte výšku</title>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r + 6}
                    fill="transparent"
                    style={{ cursor: isDragging ? "grabbing" : "grab" }}
                    onPointerDown={(e) => handlePointerDown(e, wp.index)}
                  />

                  {/* Circle background */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={
                      isDragging
                        ? "#0099cc"
                        : isSelected
                          ? "#00c2ff"
                          : "#1b3a6b"
                    }
                    stroke={
                      isDragging
                        ? "#99e9ff"
                        : isSelected
                          ? "#33cfff"
                          : "#00c2ff"
                    }
                    strokeWidth={isDragging ? 2 : 1.5}
                    style={{ cursor: isDragging ? "grabbing" : "grab" }}
                    onPointerDown={(e) => handlePointerDown(e, wp.index)}
                  />

                  {/* Waypoint number inside circle */}
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={isDragging || isSelected ? "#fff" : "#99e9ff"}
                    fontSize={r > 11 ? 10 : 9}
                    fontWeight={600}
                    style={{
                      pointerEvents: "none",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {i + 1}
                  </text>

                  {/* Height label above circle */}
                  <text
                    x={cx}
                    y={cy - r - 4}
                    textAnchor="middle"
                    fill={
                      isDragging
                        ? "#99e9ff"
                        : isSelected
                          ? "#33cfff"
                          : "#94a3b8"
                    }
                    fontSize={9}
                    fontWeight={isDragging ? 700 : 500}
                    style={{
                      pointerEvents: "none",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {displayHeight(wp)}m
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
