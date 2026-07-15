import { useMissionStore } from "@/store/missionStore";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocationSearch } from "@/components/ui/location-search";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ActionEditor } from "./ActionEditor";
import { calculateIdealGimbalPitch } from "@/lib/geo";
import { usePreferencesStore } from "@/store/preferencesStore";
import {
  heightLabel,
  speedLabel,
  toDisplayHeight,
  fromDisplayHeight,
  toDisplaySpeed,
  fromDisplaySpeed,
  formatDistance,
  formatHeight,
  speedRange,
} from "@/lib/units";
import type { HeadingMode, TurnMode } from "@droneroute/shared";

/**
 * Calculate the bearing (heading) from one lat/lng point to another.
 * Returns degrees in -180..180 range where 0 = North, 90 = East, -90 = West.
 */
function calculateBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  let bearing = toDeg(Math.atan2(y, x));
  // Normalize to -180..180
  if (bearing > 180) bearing -= 360;
  if (bearing < -180) bearing += 360;
  return Math.round(bearing);
}

interface WaypointEditorInlineProps {
  waypointIndex: number;
}

export function WaypointEditorInline({
  waypointIndex,
}: WaypointEditorInlineProps) {
  const { waypoints, updateWaypoint, config, pois, setFlyToTarget } =
    useMissionStore();
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  const wp = waypoints.find((w) => w.index === waypointIndex);
  if (!wp) return null;

  const update = (updates: Record<string, any>) => {
    updateWaypoint(wp.index, updates);
  };

  return (
    <div className="p-3 space-y-3">
      <div>
        <Label className="text-xs">Přesunout na adresu nebo souřadnice</Label>
        <LocationSearch
          onLocationFound={(lat, lng) => {
            update({ latitude: lat, longitude: lng });
            setFlyToTarget([lat, lng]);
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Výška ({heightLabel(unitSystem)})</Label>
          <Input
            type="number"
            value={toDisplayHeight(wp.height, unitSystem)}
            onChange={(e) =>
              update({
                height: Math.max(
                  1,
                  fromDisplayHeight(
                    parseFloat(e.target.value) || 1,
                    unitSystem,
                  ),
                ),
              })
            }
            min={1}
            max={500}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">Rychlost ({speedLabel(unitSystem)})</Label>
          <Input
            type="number"
            value={toDisplaySpeed(wp.speed, unitSystem)}
            onChange={(e) =>
              update({
                speed: fromDisplaySpeed(
                  parseFloat(e.target.value) || 1,
                  unitSystem,
                ),
                useGlobalSpeed: false,
              })
            }
            min={speedRange(unitSystem).min}
            max={speedRange(unitSystem).max}
            step={speedRange(unitSystem).step}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1">
          <Label className="text-xs">Náklon gimbalu (&deg;)</Label>
          {(() => {
            const targetPoi =
              !wp.useGlobalHeadingParam &&
              wp.headingMode === "towardPOI" &&
              wp.poiId
                ? pois.find((p) => p.id === wp.poiId)
                : null;
            if (!targetPoi) return null;
            const { pitch: suggested, distance } = calculateIdealGimbalPitch(
              wp,
              targetPoi,
            );
            const isAlreadyApplied = wp.gimbalPitchAngle === suggested;
            const heightDiff = wp.height - targetPoi.height;
            const distLabel = formatDistance(distance, unitSystem);
            const heightDesc =
              heightDiff > 0
                ? `${formatHeight(heightDiff, unitSystem)} nad`
                : heightDiff < 0
                  ? `${formatHeight(Math.abs(heightDiff), unitSystem)} pod`
                  : "ve stejné úrovni jako";
            const tooltip = `Namiřte kameru přímo na ${targetPoi.name} — ideální úhel pro záběr.\n\n${distLabel} daleko, ${heightDesc}. Kliknutím použijete ${suggested}°.`;
            return (
              <button
                type="button"
                title={tooltip}
                onClick={() => {
                  if (!isAlreadyApplied)
                    update({ gimbalPitchAngle: suggested });
                }}
                className={`text-[10px] font-medium transition-colors ${
                  isAlreadyApplied
                    ? "text-green-400 cursor-default"
                    : "text-green-400/60 hover:text-green-400 cursor-pointer"
                }`}
              >
                Ideální náklon: {suggested}&deg;
              </button>
            );
          })()}
        </div>
        <Input
          type="number"
          value={wp.gimbalPitchAngle}
          onChange={(e) =>
            update({ gimbalPitchAngle: parseFloat(e.target.value) || 0 })
          }
          min={-120}
          max={45}
          step={5}
          className="h-8 text-xs"
        />
        <div className="text-[10px] text-muted-foreground mt-0.5">
          -90&deg; = přímo dolů, 0&deg; = horizont
        </div>
      </div>

      <div>
        <Label className="text-xs">Režim natočení</Label>
        <Select
          value={
            wp.useGlobalHeadingParam
              ? "global"
              : wp.headingMode || "followWayline"
          }
          onValueChange={(v) => {
            if (v === "global") {
              update({ useGlobalHeadingParam: true });
            } else {
              const updates: Record<string, any> = {
                useGlobalHeadingParam: false,
                headingMode: v as HeadingMode,
              };
              // Auto-set heading angle toward the POI when switching to fixed/manual and there's exactly one POI
              if ((v === "fixed" || v === "manually") && pois.length === 1) {
                const poi = pois[0];
                updates.headingAngle = calculateBearing(
                  wp.latitude,
                  wp.longitude,
                  poi.latitude,
                  poi.longitude,
                );
              }
              update(updates);
            }
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">
              Použít globální ({config.globalHeadingMode})
            </SelectItem>
            <SelectItem value="followWayline">Podle trasy</SelectItem>
            <SelectItem value="manually">Ruční</SelectItem>
            <SelectItem value="fixed">Pevné</SelectItem>
            <SelectItem value="smoothTransition">Plynulý přechod</SelectItem>
            <SelectItem value="towardPOI">Směrem k POI</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!wp.useGlobalHeadingParam &&
        (wp.headingMode === "manually" ||
          wp.headingMode === "fixed" ||
          wp.headingMode === "smoothTransition") && (
          <div>
            <Label className="text-xs">Úhel natočení (&deg;)</Label>
            <Input
              type="number"
              value={wp.headingAngle ?? 0}
              onChange={(e) =>
                update({ headingAngle: parseFloat(e.target.value) || 0 })
              }
              min={-180}
              max={180}
              className="h-8 text-xs"
            />
            <div className="text-[10px] text-muted-foreground mt-0.5">
              0&deg; = sever, 90&deg; = východ, -90&deg; = západ
            </div>
          </div>
        )}

      {!wp.useGlobalHeadingParam && wp.headingMode === "towardPOI" && (
        <div>
          <Label className="text-xs">Cílový POI</Label>
          <Select
            value={wp.poiId || "none"}
            onValueChange={(v) =>
              update({ poiId: v === "none" ? undefined : v })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Vyberte POI..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Žádný</SelectItem>
              {pois.map((poi) => (
                <SelectItem key={poi.id} value={poi.id}>
                  {poi.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pois.length === 0 && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Nejdřív přidejte POI na mapu
            </div>
          )}
        </div>
      )}

      <div>
        <Label className="text-xs">Režim zatáčení</Label>
        <Select
          value={
            wp.useGlobalTurnParam
              ? "global"
              : wp.turnMode || config.globalTurnMode
          }
          onValueChange={(v) => {
            if (v === "global") {
              update({ useGlobalTurnParam: true });
            } else {
              update({ useGlobalTurnParam: false, turnMode: v as TurnMode });
            }
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">Použít globální</SelectItem>
            <SelectItem value="coordinateTurn">Koordinovaná zatáčka</SelectItem>
            <SelectItem value="toPointAndStopWithDiscontinuityCurvature">
              Zastavit v bodě (ostré)
            </SelectItem>
            <SelectItem value="toPointAndStopWithContinuityCurvature">
              Zastavit v bodě (plynulé)
            </SelectItem>
            <SelectItem value="toPointAndPassWithContinuityCurvature">
              Projet bodem (plynulé)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <ActionEditor waypointIndex={wp.index} />
    </div>
  );
}
