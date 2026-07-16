import { CircleCheck, TriangleAlert, CircleX } from "lucide-react";
import {
  assessOverallFlightConditions,
  type FlightConditionsInput,
} from "@/lib/flightConditions";
import type { FlightVerdict } from "@/lib/weather";

const VERDICT_COPY: Record<
  FlightVerdict,
  { icon: typeof CircleCheck; className: string; label: string }
> = {
  go: {
    icon: CircleCheck,
    className: "text-emerald-400",
    label: "Podmínky vhodné k letu",
  },
  caution: {
    icon: TriangleAlert,
    className: "text-amber-500",
    label: "Zvýšená opatrnost",
  },
  "no-go": {
    icon: CircleX,
    className: "text-red-400",
    label: "Nedoporučeno létat",
  },
};

/**
 * Single traffic-light-style go/no-go summary for the mission's location,
 * combining the existing weather-based verdict (wind, temperature,
 * precipitation, storm risk) with geomagnetic activity (Kp index) and
 * proximity to civil twilight — see assessOverallFlightConditions in
 * lib/flightConditions.ts for the actual combination logic. Purely a
 * presentational wrapper around it: read-only consumer of whatever the
 * caller already fetched (weather store + mission config), no fetching
 * of its own.
 */
export function FlightConditionsSummary({
  day,
  kp,
  twilightStatus,
}: FlightConditionsInput) {
  const assessment = assessOverallFlightConditions({ day, kp, twilightStatus });
  const { icon: Icon, className, label } = VERDICT_COPY[assessment.verdict];

  return (
    <div
      className={`flex flex-col gap-1 px-2 py-1.5 rounded-md bg-muted/20 ${className}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </div>
      {assessment.reasons.length > 0 && (
        <ul className="text-[10px] font-normal opacity-80 pl-5 list-disc">
          {assessment.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
