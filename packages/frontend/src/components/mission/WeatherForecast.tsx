import { useEffect } from "react";
import {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudFog,
  Wind,
  Droplets,
  CircleCheck,
  TriangleAlert,
  CircleX,
} from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import { useWeatherStore } from "@/store/weatherStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import {
  groupForecastByDay,
  symbolLabel,
  symbolIconKey,
  assessFlightConditions,
  type FlightVerdict,
} from "@/lib/weather";
import {
  toDisplaySpeed,
  speedLabel,
  toDisplayTemperature,
  temperatureLabel,
} from "@/lib/units";

const ICONS = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  snow: CloudSnow,
  fog: CloudFog,
};

/** Wind speed (m/s) above which most consumer drones start struggling — shown as a caution color, not a hard block. */
const CAUTION_WIND_MS = 8;

const MAX_DAYS_SHOWN = 5;

const VERDICT_STYLE: Record<
  FlightVerdict,
  { icon: typeof CircleCheck; color: string; label: string }
> = {
  go: { icon: CircleCheck, color: "text-emerald-400", label: "Vhodné" },
  caution: {
    icon: TriangleAlert,
    color: "text-amber-500",
    label: "Opatrnost",
  },
  "no-go": { icon: CircleX, color: "text-red-400", label: "Nevhodné" },
};

// Formatted manually (rather than via toLocaleDateString) so the label is
// always Czech regardless of the browser's locale, and reads as the
// familiar "den. měsíc." format instead of Intl's abbreviated Czech month
// names (e.g. "čvc" for July), which are correct but less recognizable.
const CZECH_WEEKDAYS_SHORT = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

function dayLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00Z`);
  const weekday = CZECH_WEEKDAYS_SHORT[date.getUTCDay()];
  return `${weekday} ${date.getUTCDate()}. ${date.getUTCMonth() + 1}.`;
}

export function WeatherForecast() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const { forecast, isLoading, fetchForLocation } = useWeatherStore();
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  const referencePoint = waypoints[0]
    ? { lat: waypoints[0].latitude, lng: waypoints[0].longitude }
    : null;

  useEffect(() => {
    if (referencePoint) {
      fetchForLocation(referencePoint.lat, referencePoint.lng);
    }
  }, [referencePoint?.lat, referencePoint?.lng, fetchForLocation]);

  if (!referencePoint) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <Cloud className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">Zatím žádná předpověď</p>
        <p className="text-xs mt-1">
          Umístěte bod trasy pro zobrazení předpovědi pro dané místo
        </p>
      </div>
    );
  }

  if (isLoading && forecast.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        Načítání předpovědi…
      </div>
    );
  }

  const days = groupForecastByDay(forecast).slice(0, MAX_DAYS_SHOWN);

  if (days.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        Předpověď momentálně není dostupná.
      </div>
    );
  }

  const todayAssessment = assessFlightConditions(days[0]);
  const TodayIcon = VERDICT_STYLE[todayAssessment.verdict].icon;

  return (
    <div className="flex flex-col gap-1 p-2">
      <div
        className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md bg-muted/20 ${VERDICT_STYLE[todayAssessment.verdict].color}`}
        title={
          todayAssessment.reasons.length > 0
            ? todayAssessment.reasons.join(", ")
            : undefined
        }
      >
        <TodayIcon className="h-4 w-4 shrink-0" />
        <span>{VERDICT_STYLE[todayAssessment.verdict].label} k letu dnes</span>
        {todayAssessment.reasons.length > 0 && (
          <span className="text-[10px] font-normal opacity-80">
            ({todayAssessment.reasons.join(", ")})
          </span>
        )}
      </div>
      {days.map((day) => {
        const Icon = ICONS[symbolIconKey(day.symbolCode)];
        const windMs = day.maxWindSpeedMs;
        const isWindy = windMs !== null && windMs >= CAUTION_WIND_MS;
        const assessment = assessFlightConditions(day);
        const VerdictIcon = VERDICT_STYLE[assessment.verdict].icon;

        return (
          <div
            key={day.date}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 border border-transparent"
            title={symbolLabel(day.symbolCode)}
          >
            <Icon className="h-4 w-4 text-sky-400 shrink-0" />
            <div className="w-16 text-xs font-medium shrink-0">
              {dayLabel(day.date)}
            </div>
            <div className="text-[10px] text-muted-foreground flex-1">
              {day.minTempC !== null && day.maxTempC !== null
                ? `${toDisplayTemperature(day.minTempC, unitSystem)}–${toDisplayTemperature(day.maxTempC, unitSystem)}${temperatureLabel(unitSystem)}`
                : "—"}
            </div>
            <div
              className={`flex items-center gap-1 text-[10px] shrink-0 ${
                isWindy ? "text-amber-500" : "text-muted-foreground"
              }`}
              title="Maximální rychlost větru"
            >
              <Wind className="h-3 w-3" />
              {windMs !== null
                ? `${toDisplaySpeed(windMs, unitSystem)}${speedLabel(unitSystem)}`
                : "—"}
            </div>
            <div
              className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0"
              title="Celkové srážky"
            >
              <Droplets className="h-3 w-3" />
              {day.totalPrecipitationMm !== null
                ? `${day.totalPrecipitationMm}mm`
                : "—"}
            </div>
            <span
              title={
                assessment.reasons.length > 0
                  ? assessment.reasons.join(", ")
                  : VERDICT_STYLE[assessment.verdict].label
              }
            >
              <VerdictIcon
                className={`h-3.5 w-3.5 shrink-0 ${VERDICT_STYLE[assessment.verdict].color}`}
              />
            </span>
          </div>
        );
      })}
      <div className="text-[10px] text-muted-foreground px-2 pt-1">
        Předpověď pro místo prvního bodu trasy, přes MET Norway.
      </div>
    </div>
  );
}
