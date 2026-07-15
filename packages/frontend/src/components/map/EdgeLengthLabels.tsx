import { Marker } from "react-map-gl/mapbox";
import { usePreferencesStore } from "@/store/preferencesStore";
import { haversineDistance } from "@/lib/geo";
import { toDisplayDistance, distanceLabel } from "@/lib/units";

const DEFAULT_LABEL_CLASS_NAME =
  "pointer-events-none px-1 py-0.5 rounded bg-yellow-950/70 border border-yellow-400/50 text-[10px] font-mono text-yellow-200 whitespace-nowrap";

/** Small map label showing the distance between two points, at their midpoint. */
function EdgeLengthLabel({
  a,
  b,
  labelClassName,
  offset,
}: {
  a: [number, number];
  b: [number, number];
  labelClassName: string;
  offset?: [number, number];
}) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const distM = haversineDistance(a[0], a[1], b[0], b[1]);
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return (
    <Marker
      longitude={mid[1]}
      latitude={mid[0]}
      anchor="center"
      offset={offset}
    >
      <div className={labelClassName}>
        {Math.round(toDisplayDistance(distM, unitSystem))}
        {distanceLabel(unitSystem)}
      </div>
    </Marker>
  );
}

/** Edge-length labels for every side of a (possibly still-open) traced polygon. */
export function EdgeLengthLabels({
  vertices,
  closed,
  labelClassName = DEFAULT_LABEL_CLASS_NAME,
  offset,
}: {
  vertices: [number, number][];
  closed: boolean;
  /** Tailwind classes for each label's pill — defaults to the yellow used for solar-panel tracing; pass a theme matching the caller's own drawing color otherwise. */
  labelClassName?: string;
  /** Pixel offset for each label, e.g. to avoid sitting exactly on top of another marker placed at the same edge midpoint. */
  offset?: [number, number];
}) {
  if (vertices.length < 2) return null;
  const edges: [[number, number], [number, number]][] = [];
  for (let i = 0; i + 1 < vertices.length; i++) {
    edges.push([vertices[i], vertices[i + 1]]);
  }
  if (closed && vertices.length >= 3) {
    edges.push([vertices[vertices.length - 1], vertices[0]]);
  }
  return (
    <>
      {edges.map(([a, b], i) => (
        <EdgeLengthLabel
          key={`edge-${i}`}
          a={a}
          b={b}
          labelClassName={labelClassName}
          offset={offset}
        />
      ))}
    </>
  );
}
