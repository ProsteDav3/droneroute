import { useState } from "react";
import { toast } from "sonner";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import {
  speedLabel,
  heightLabel,
  toDisplaySpeed,
  fromDisplaySpeed,
  toDisplayHeight,
  fromDisplayHeight,
  speedRange,
} from "@/lib/units";
import { computeSpeedForDuration } from "@/lib/flightStats";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DRONE_MODELS } from "@droneroute/shared";
import type {
  HeadingMode,
  FinishAction,
  RCLostAction,
  HeightMode,
  FlyToWaylineMode,
} from "@droneroute/shared";

export function MissionConfig() {
  const { config, setConfig, waypoints } = useMissionStore();
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const [targetDurationInput, setTargetDurationInput] = useState("");

  const handleApplyTargetDuration = () => {
    const targetTimeS = parseFloat(targetDurationInput);
    if (!(targetTimeS > 0)) {
      toast.warning("Zadejte platnou cílovou dobu letu v sekundách");
      return;
    }
    // Solve for the global speed only — waypoints with their own speed
    // override (useGlobalSpeed: false) keep their own fixed speed, since
    // this control only changes config.autoFlightSpeed, not per-waypoint
    // overrides. Warn up front so the user knows those waypoints won't be
    // affected and the resulting duration may not exactly hit the target.
    const hasOverriddenWaypoints = waypoints.some((wp) => !wp.useGlobalSpeed);
    const speed = computeSpeedForDuration(waypoints, targetTimeS, {
      forceUniformSpeed: false,
    });
    if (speed === null) {
      toast.warning(
        hasOverriddenWaypoints
          ? "Tuto dobu letu nelze dosáhnout — mise obsahuje body s vlastní rychlostí, které globální rychlost letu neovlivní"
          : "Tuto dobu letu nelze s aktuální trasou dosáhnout v rozsahu rychlosti 1-15 m/s",
      );
      return;
    }
    setConfig({ autoFlightSpeed: speed });
    toast.success(
      `Rychlost letu nastavena na ${toDisplaySpeed(speed, unitSystem)} ${speedLabel(unitSystem)}${
        hasOverriddenWaypoints
          ? " (body s vlastní rychlostí zůstávají beze změny)"
          : ""
      }`,
    );
  };

  const selectedDrone = DRONE_MODELS.find(
    (d) =>
      d.droneEnumValue === config.droneEnumValue &&
      d.droneSubEnumValue === config.droneSubEnumValue,
  );

  return (
    <div className="p-3 space-y-3">
      <div>
        <Label className="text-xs">Model dronu</Label>
        <Select
          value={`${config.droneEnumValue}-${config.droneSubEnumValue}`}
          onValueChange={(v) => {
            const [drone, sub] = v.split("-").map(Number);
            const model = DRONE_MODELS.find(
              (d) => d.droneEnumValue === drone && d.droneSubEnumValue === sub,
            );
            if (model) {
              setConfig({
                droneEnumValue: model.droneEnumValue,
                droneSubEnumValue: model.droneSubEnumValue,
                payloadEnumValue: model.payloads[0]?.payloadEnumValue || 0,
                payloadSubEnumValue:
                  model.payloads[0]?.payloadSubEnumValue ?? 0,
              });
            }
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DRONE_MODELS.map((d) => (
              <SelectItem
                key={`${d.droneEnumValue}-${d.droneSubEnumValue}`}
                value={`${d.droneEnumValue}-${d.droneSubEnumValue}`}
              >
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedDrone && selectedDrone.payloads.length > 1 && (
        <div>
          <Label className="text-xs">Náklad</Label>
          <Select
            value={String(config.payloadEnumValue)}
            onValueChange={(v) => {
              const payloadEnumValue = parseInt(v);
              const payload = selectedDrone.payloads.find(
                (p) => p.payloadEnumValue === payloadEnumValue,
              );
              setConfig({
                payloadEnumValue,
                payloadSubEnumValue: payload?.payloadSubEnumValue ?? 0,
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectedDrone.payloads.map((p) => (
                <SelectItem
                  key={p.payloadEnumValue}
                  value={String(p.payloadEnumValue)}
                >
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">
            Rychlost letu ({speedLabel(unitSystem)})
          </Label>
          <Input
            type="number"
            value={toDisplaySpeed(config.autoFlightSpeed, unitSystem)}
            onChange={(e) =>
              setConfig({
                autoFlightSpeed: fromDisplaySpeed(
                  parseFloat(e.target.value) || 1,
                  unitSystem,
                ),
              })
            }
            min={speedRange(unitSystem).min}
            max={speedRange(unitSystem).max}
            step={speedRange(unitSystem).step}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">
            Výška vzletu ({heightLabel(unitSystem)})
          </Label>
          <Input
            type="number"
            value={toDisplayHeight(config.takeOffSecurityHeight, unitSystem)}
            onChange={(e) =>
              setConfig({
                takeOffSecurityHeight: fromDisplayHeight(
                  parseFloat(e.target.value) || 1.2,
                  unitSystem,
                ),
              })
            }
            min={1.2}
            max={1500}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Cílová doba letu (s)</Label>
        <div className="flex gap-2">
          <Input
            type="number"
            value={targetDurationInput}
            onChange={(e) => setTargetDurationInput(e.target.value)}
            min={1}
            placeholder="např. 60"
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs shrink-0"
            onClick={handleApplyTargetDuration}
            disabled={waypoints.length < 2}
          >
            Dopočítat rychlost
          </Button>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Zadejte, jak dlouho má celý let trvat — rychlost letu (
          {speedLabel(unitSystem)}) se dopočítá zpětně z aktuální trasy. Body
          trasy s vlastní rychlostí (nastavenou individuálně) tím nejsou
          ovlivněny.
        </div>
      </div>

      <div>
        <Label className="text-xs">Max. baterie (min)</Label>
        <Input
          type="number"
          value={config.maxBatteryMinutes}
          onChange={(e) =>
            setConfig({
              maxBatteryMinutes: Math.max(1, parseInt(e.target.value) || 1),
            })
          }
          min={1}
          max={120}
          step={1}
          className="h-8 text-xs"
        />
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Upozornění, když čas letu přesáhne tento limit
        </div>
      </div>

      <div>
        <Label className="text-xs">Reference výšky</Label>
        <Select
          value={config.heightMode}
          onValueChange={(v) => setConfig({ heightMode: v as HeightMode })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relativeToStartPoint">
              Relativně od startu
            </SelectItem>
            <SelectItem value="aboveGroundLevel">Nad terénem (AGL)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Režim natočení</Label>
        <Select
          value={config.globalHeadingMode}
          onValueChange={(v) =>
            setConfig({ globalHeadingMode: v as HeadingMode })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="followWayline">Podle trasy</SelectItem>
            <SelectItem value="manually">Ruční</SelectItem>
            <SelectItem value="fixed">Pevné</SelectItem>
            <SelectItem value="smoothTransition">Plynulý přechod</SelectItem>
            <SelectItem value="towardPOI">Směrem k POI</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Výchozí hodnota jen pro body trasy bez vlastního nastavení natočení —
          šablony jako Orbit dávají každému bodu vlastní režim (např. "Směrem k
          POI"), který tuto výchozí hodnotu přebíjí a v praxi rozhoduje, jak
          dron skutečně letí.
        </div>
      </div>

      <div>
        <Label className="text-xs">Režim přeletu</Label>
        <Select
          value={config.flyToWaylineMode}
          onValueChange={(v) =>
            setConfig({ flyToWaylineMode: v as FlyToWaylineMode })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="safely">Bezpečně (nejdřív stoupání)</SelectItem>
            <SelectItem value="pointToPoint">Přímo (bod k bodu)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Akce po dokončení</Label>
        <Select
          value={config.finishAction}
          onValueChange={(v) => setConfig({ finishAction: v as FinishAction })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="goHome">Návrat domů</SelectItem>
            <SelectItem value="autoLand">Automatické přistání</SelectItem>
            <SelectItem value="gotoFirstWaypoint">
              Přejít na první WP
            </SelectItem>
            <SelectItem value="noAction">Bez akce (viset)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Akce při ztrátě signálu RC</Label>
        <Select
          value={config.executeRCLostAction}
          onValueChange={(v) =>
            setConfig({ executeRCLostAction: v as RCLostAction })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="goBack">Návrat (RTH)</SelectItem>
            <SelectItem value="landing">Přistát</SelectItem>
            <SelectItem value="hover">Viset</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">
          Přeletová rychlost ({speedLabel(unitSystem)})
        </Label>
        <Input
          type="number"
          value={toDisplaySpeed(config.globalTransitionalSpeed, unitSystem)}
          onChange={(e) =>
            setConfig({
              globalTransitionalSpeed: fromDisplaySpeed(
                parseFloat(e.target.value) || 1,
                unitSystem,
              ),
            })
          }
          min={speedRange(unitSystem).min}
          max={speedRange(unitSystem).max}
          step={speedRange(unitSystem).step}
          className="h-8 text-xs"
        />
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Rychlost letu k prvnímu bodu trasy
        </div>
      </div>
    </div>
  );
}
