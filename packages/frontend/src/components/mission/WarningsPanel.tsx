import { AlertTriangle, X, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMissionStore } from "@/store/missionStore";
import { useAirspaceStore } from "@/store/airspaceStore";
import { getAirspaceWarnings, formatAirspaceWarningMessage } from "@/lib/geo";
import { computeBoundingBox } from "@/lib/missionBounds";
import { api } from "@/lib/api";

export interface Warning {
  id: string;
  type: "battery" | "obstacle" | "airspace";
  message: string;
}

interface WarningsPanelProps {
  warnings: Warning[];
}

interface NotamLink {
  url: string;
  note: string;
}

interface PermitApi {
  id: string;
  description: string;
  expiryDate: string | null;
}

/** How many days before expiry a permit starts showing an "expiring soon" warning. */
const PERMIT_EXPIRY_WARNING_DAYS = 14;

/** Debounce for the NOTAM link fetch while waypoints are actively being edited. */
const NOTAM_FETCH_DEBOUNCE_MS = 500;

function computePermitWarnings(permits: PermitApi[]): Warning[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const warnings: Warning[] = [];

  for (const permit of permits) {
    if (!permit.expiryDate) continue;
    const expiry = new Date(permit.expiryDate);
    if (Number.isNaN(expiry.getTime())) continue;
    const daysLeft = Math.floor(
      (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysLeft < 0) {
      warnings.push({
        id: `permit-expired-${permit.id}`,
        type: "airspace",
        message: `Povolení „${permit.description}“ vypršelo ${permit.expiryDate}`,
      });
    } else if (daysLeft <= PERMIT_EXPIRY_WARNING_DAYS) {
      warnings.push({
        id: `permit-expiring-${permit.id}`,
        type: "airspace",
        message: `Povolení „${permit.description}“ brzy vyprší (${permit.expiryDate})`,
      });
    }
  }

  return warnings;
}

/**
 * Warnings panel for the mission editor. Renders both:
 *   - the generic aggregate warnings App.tsx computes and passes in (battery,
 *     obstacle counts, airspace zone counts), and
 *   - detail it computes for itself (per-zone airspace conflicts with
 *     altitude limits, permit expiry) by reading missionStore/airspaceStore
 *     directly — this component can't receive extra props without touching
 *     App.tsx, which is out of scope for this branch, so it self-fetches
 *     instead of being fed richer data top-down.
 */
export function WarningsPanel({ warnings }: WarningsPanelProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const waypoints = useMissionStore((s) => s.waypoints);
  const missionId = useMissionStore((s) => s.missionId);
  const zones = useAirspaceStore((s) => s.zones);
  const airspaceEnabled = useAirspaceStore((s) => s.enabled);

  // Detailed per-zone conflict messages, e.g. "Trasa letu protíná zónu X
  // (limit 120 m AGL)" — a finer-grained view than the count-only aggregate
  // messages already in `warnings`.
  const zoneConflictWarnings = useMemo((): Warning[] => {
    if (!airspaceEnabled || zones.length === 0 || waypoints.length === 0) {
      return [];
    }
    return getAirspaceWarnings(waypoints, zones).map((w) => ({
      id: `airspace-zone-${w.zoneId}`,
      type: "airspace" as const,
      message: formatAirspaceWarningMessage(w),
    }));
  }, [airspaceEnabled, zones, waypoints]);

  // NOTAM briefing deep link — see backend services/airspace/notam.ts for
  // why this is a link-out rather than live data.
  const [notamLink, setNotamLink] = useState<NotamLink | null>(null);
  const notamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bbox = computeBoundingBox(waypoints);
    if (notamTimerRef.current) clearTimeout(notamTimerRef.current);
    if (!bbox) {
      setNotamLink(null);
      return;
    }
    notamTimerRef.current = setTimeout(() => {
      api
        .get<NotamLink>(
          `/notam?south=${bbox.south}&west=${bbox.west}&north=${bbox.north}&east=${bbox.east}`,
        )
        .then(setNotamLink)
        .catch(() => setNotamLink(null));
    }, NOTAM_FETCH_DEBOUNCE_MS);
    return () => {
      if (notamTimerRef.current) clearTimeout(notamTimerRef.current);
    };
  }, [waypoints]);

  // Permit expiry warnings for the current (saved) mission.
  const [permitWarnings, setPermitWarnings] = useState<Warning[]>([]);
  useEffect(() => {
    if (!missionId) {
      setPermitWarnings([]);
      return;
    }
    let cancelled = false;
    api
      .get<PermitApi[]>(`/permits?missionId=${missionId}`)
      .then((permits) => {
        if (!cancelled) setPermitWarnings(computePermitWarnings(permits));
      })
      .catch(() => {
        if (!cancelled) setPermitWarnings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [missionId]);

  const allWarnings = useMemo(
    () => [...warnings, ...zoneConflictWarnings, ...permitWarnings],
    [warnings, zoneConflictWarnings, permitWarnings],
  );

  const visible = allWarnings.filter((w) => !dismissed.has(w.id));

  if (visible.length === 0 && !notamLink) return null;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] flex flex-col gap-1.5 pointer-events-none max-w-[600px] w-full px-4">
      {visible.map((w) => {
        const isProhibited = w.id === "airspace-prohibited";
        const borderColor = isProhibited
          ? "border-red-400"
          : "border-orange-400";
        const bgColor = isProhibited ? "bg-red-600/90" : "bg-orange-600/90";
        const iconColor = isProhibited ? "text-red-100" : "text-orange-100";
        const dismissColor = isProhibited
          ? "text-red-200/70"
          : "text-orange-200/70";
        return (
          <div
            key={w.id}
            className={`pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-lg border-2 ${borderColor} ${bgColor} text-white text-xs font-medium shadow-lg backdrop-blur-sm`}
          >
            <AlertTriangle className={`h-3.5 w-3.5 ${iconColor} shrink-0`} />
            <span className="flex-1">{w.message}</span>
            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(w.id))}
              className={`shrink-0 ${dismissColor} hover:text-white transition-colors`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      {notamLink && (
        <a
          href={notamLink.url}
          target="_blank"
          rel="noopener noreferrer"
          title={notamLink.note}
          className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-lg border border-sky-400/60 bg-sky-950/80 text-sky-100 text-xs font-medium shadow-lg backdrop-blur-sm hover:bg-sky-900/90 transition-colors self-center"
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span>Zobrazit NOTAM pro tuto oblast</span>
        </a>
      )}
    </div>
  );
}
