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
  Sunrise,
  Sunset,
  Satellite,
  Moon,
} from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import { useWeatherStore } from "@/store/weatherStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import {
  groupForecastByDay,
  symbolLabel,
  symbolIconKey,
  assessFlightConditions,
  CAUTION_WIND_MS,
  type FlightVerdict,
} from "@/lib/weather";
import { getSunTimes, assessTwilightStatus } from "@/lib/sunPosition";
import { KP_CAUTION_THRESHOLD } from "@/lib/flightConditions";
import { FlightConditionsSummary } from "./FlightConditionsSummary";
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

const MAX_DAYS_SHOWN = 5;

function timeLabel(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  const {
    forecast,
    isLoading,
    fetchForLocation,
    windAloft,
    fetchWindAloft,
    kp,
    fetchKpIndex,
  } = useWeatherStore();
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  const referencePoint = waypoints[0]
    ? {
        lat: waypoints[0].latitude,
        lng: waypoints[0].longitude,
        heightM: waypoints[0].height,
      }
    : null;

  useEffect(() => {
    if (referencePoint) {
      fetchForLocation(referencePoint.lat, referencePoint.lng);
      fetchWindAloft(
        referencePoint.lat,
        referencePoint.lng,
        referencePoint.heightM,
      );
      fetchKpIndex();
    }
  }, [
    referencePoint?.lat,
    referencePoint?.lng,
    referencePoint?.heightM,
    fetchForLocation,
    fetchWindAloft,
    fetchKpIndex,
  ]);

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

  const now = new Date();
  const sunTimes = getSunTimes(now, referencePoint.lat, referencePoint.lng);
  const twilightStatus = assessTwilightStatus(now, sunTimes);
  const isKpElevated = kp !== null && kp.kp >= KP_CAUTION_THRESHOLD;

  return (
    <div className="flex flex-col gap-1 p-2">
      <FlightConditionsSummary
        day={days[0]}
        kp={kp?.kp ?? null}
        twilightStatus={twilightStatus}
      />
      {windAloft && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-2">
          <Wind className="h-3 w-3 shrink-0" />
          <span>
            Vítr ve výšce {windAloft.altitudeM} m:{" "}
            {windAloft.windSpeedMs !== null
              ? `${toDisplaySpeed(windAloft.windSpeedMs, unitSystem)}${speedLabel(unitSystem)}`
              : "—"}
            {windAloft.windFromDirectionDeg !== null &&
              ` od ${Math.round(windAloft.windFromDirectionDeg)}°`}
          </span>
        </div>
      )}
      <div
        className={`flex items-center gap-1.5 text-[10px] px-2 ${isKpElevated ? "text-amber-500" : "text-muted-foreground"}`}
      >
        <Satellite className="h-3 w-3 shrink-0" />
        {kp !== null ? (
          <span>
            Kp geomagnetický index: {kp.kp.toFixed(1)}
            {isKpElevated &&
              " — zvýšená geomagnetická aktivita, GPS přesnost může být snížená"}
          </span>
        ) : (
          <span>Kp geomagnetický index: —</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground px-2">
        <span className="flex items-center gap-1" title="Východ slunce">
          <Sunrise className="h-3 w-3 shrink-0" />
          {timeLabel(sunTimes.sunrise)}
        </span>
        <span className="flex items-center gap-1" title="Západ slunce">
          <Sunset className="h-3 w-3 shrink-0" />
          {timeLabel(sunTimes.sunset)}
        </span>
        <span
          title={`Ranní zlatá hodina: ${timeLabel(sunTimes.morningGoldenHourStart)}–${timeLabel(sunTimes.morningGoldenHourEnd)}`}
        >
          Ranní zlatá hodina do {timeLabel(sunTimes.morningGoldenHourEnd)}
        </span>
        <span
          title={`Večerní zlatá hodina: ${timeLabel(sunTimes.eveningGoldenHourStart)}–${timeLabel(sunTimes.eveningGoldenHourEnd)}`}
        >
          Večerní zlatá hodina od {timeLabel(sunTimes.eveningGoldenHourStart)}
        </span>
      </div>
      {twilightStatus !== "day" && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-500 px-2">
          <Moon className="h-3 w-3 shrink-0" />
          <span>
            {twilightStatus === "night"
              ? "Blízko občanského soumraku nebo po něm"
              : "Blíží se občanský soumrak"}{" "}
            — mohou platit pravidla pro noční létání, ověřte národní předpisy.
          </span>
        </div>
      )}
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
        Předpověď pro místo prvního bodu trasy — počasí přes MET Norway, vítr ve
        výšce přes Open-Meteo, Kp index přes NOAA SWPC.
      </div>
    </div>
  );
}
