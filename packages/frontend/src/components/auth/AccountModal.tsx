import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuthStore } from "@/store/authStore";
import { useConfigStore } from "@/store/configStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { useAirspaceStore, AIRSPACE_PROVIDERS } from "@/store/airspaceStore";
import { api } from "@/lib/api";
import { X, KeyRound } from "lucide-react";
import {
  speedLabel,
  heightLabel,
  toDisplaySpeed,
  fromDisplaySpeed,
  toDisplayHeight,
  fromDisplayHeight,
  speedRange,
} from "@/lib/units";
import {
  DRONE_MODELS,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_MISSION_CONFIG,
} from "@droneroute/shared";
import type {
  HeadingMode,
  FinishAction,
  RCLostAction,
  HeightMode,
  FlyToWaylineMode,
  MissionConfig,
  UserPreferences,
  VisualizationPreferences,
  UnitSystem,
} from "@droneroute/shared";

interface AccountModalProps {
  onClose: () => void;
}

export function AccountModal({ onClose }: AccountModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const { email } = useAuthStore();
  const { selfHosted } = useConfigStore();
  const { preferences, updatePreferences } = usePreferencesStore();
  const enabledProviders = useAirspaceStore((s) => s.enabledProviders);
  const setProviderEnabled = useAirspaceStore((s) => s.setProviderEnabled);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  // Local copies of preferences for editing
  const [vizPrefs, setVizPrefs] = useState(
    preferences?.visualization ?? DEFAULT_USER_PREFERENCES.visualization,
  );
  const [missionDefaults, setMissionDefaults] = useState(
    preferences?.missionDefaults ?? DEFAULT_MISSION_CONFIG,
  );
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(
    preferences?.unitSystem ?? "metric",
  );
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  // Sync local state when preferences load
  useEffect(() => {
    if (preferences?.visualization) setVizPrefs(preferences.visualization);
    if (preferences?.missionDefaults)
      setMissionDefaults(preferences.missionDefaults);
    if (preferences?.unitSystem) setUnitSystem(preferences.unitSystem);
  }, [preferences]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("Nová hesla se neshodují");
      return;
    }

    setSaving(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "Změna hesla se nezdařila");
    } finally {
      setSaving(false);
    }
  };

  const savePreferences = async () => {
    setPrefsSaving(true);
    setPrefsSaved(false);
    const newPrefs: UserPreferences = {
      unitSystem,
      visualization: vizPrefs,
      missionDefaults,
    };
    await updatePreferences(newPrefs);
    setPrefsSaving(false);
    setPrefsSaved(true);
    setTimeout(() => setPrefsSaved(false), 2000);
  };

  const setMissionDefault = (partial: Partial<MissionConfig>) => {
    setMissionDefaults((prev: MissionConfig) => ({ ...prev, ...partial }));
  };

  const selectedDrone = DRONE_MODELS.find(
    (d) =>
      d.droneEnumValue === missionDefaults.droneEnumValue &&
      d.droneSubEnumValue === missionDefaults.droneSubEnumValue,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-[0_0_60px_rgba(0,194,255,0.25)] w-full max-w-lg mx-4 h-[600px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">Nastavení</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <Tabs defaultValue="account" className="flex flex-col min-h-0 flex-1">
          <div className="px-5 pt-4 shrink-0">
            <TabsList className="w-full">
              <TabsTrigger value="account" className="flex-1">
                Účet
              </TabsTrigger>
              <TabsTrigger value="visualization" className="flex-1">
                Zobrazení
              </TabsTrigger>
              <TabsTrigger value="mission-defaults" className="flex-1">
                Výchozí nastavení mise
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Account tab */}
          <TabsContent
            value="account"
            className="px-5 pb-5 overflow-y-auto flex-1"
          >
            <div className="space-y-5 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">E-mail</Label>
                <p className="text-sm">{email}</p>
              </div>

              {selfHosted && (
                <form onSubmit={handleChangePassword} className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <KeyRound className="h-3 w-3" />
                    Změna hesla
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="currentPassword" className="text-xs">
                      Současné heslo
                    </Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="h-9 text-sm"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="newPassword" className="text-xs">
                      Nové heslo
                    </Label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min. 6 znaků"
                      className="h-9 text-sm"
                      required
                      minLength={6}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirmPassword" className="text-xs">
                      Potvrzení nového hesla
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-9 text-sm"
                      required
                      minLength={6}
                    />
                  </div>
                  {error && <p className="text-xs text-destructive">{error}</p>}
                  {success && (
                    <p className="text-xs text-emerald-400">
                      Heslo bylo úspěšně změněno
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="w-full h-9 text-sm"
                    disabled={saving}
                  >
                    {saving ? "Ukládání..." : "Změnit heslo"}
                  </Button>
                </form>
              )}
            </div>
          </TabsContent>

          {/* Visualization tab */}
          <TabsContent
            value="visualization"
            className="px-5 pb-5 overflow-y-auto flex-1"
          >
            <div className="space-y-4 pt-2">
              <div>
                <Label className="text-xs">Režim zobrazení</Label>
                <Select
                  value={vizPrefs.viewMode}
                  onValueChange={(v) =>
                    setVizPrefs((prev: VisualizationPreferences) => ({
                      ...prev,
                      viewMode: v as "2d" | "3d",
                    }))
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2d">2D</SelectItem>
                    <SelectItem value="3d">3D</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Styl mapy</Label>
                <Select
                  value={vizPrefs.mapStyle}
                  onValueChange={(v) =>
                    setVizPrefs((prev: VisualizationPreferences) => ({
                      ...prev,
                      mapStyle: v as "satellite" | "street",
                    }))
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="satellite">Satelitní</SelectItem>
                    <SelectItem value="street">Mapa ulic</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Jednotky</Label>
                <Select
                  value={unitSystem}
                  onValueChange={(v) => setUnitSystem(v as UnitSystem)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="metric">
                      Metrické (m, m/s, km)
                    </SelectItem>
                    <SelectItem value="imperial">
                      Imperiální (ft, mph, mi)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Extra layers */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">
                  Další vrstvy
                </Label>
                <div className="space-y-2">
                  {AIRSPACE_PROVIDERS.map((provider) => (
                    <label
                      key={provider.id}
                      className="flex items-start gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={enabledProviders.has(provider.id)}
                        onChange={(e) =>
                          setProviderEnabled(provider.id, e.target.checked)
                        }
                        className="h-4 w-4 mt-0.5 rounded border-border accent-primary"
                      />
                      <div>
                        <span className="text-sm">{provider.name}</span>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {provider.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <Button
                onClick={savePreferences}
                className="w-full h-9 text-sm"
                disabled={prefsSaving}
              >
                {prefsSaving
                  ? "Ukládání..."
                  : prefsSaved
                    ? "Uloženo!"
                    : "Uložit předvolby"}
              </Button>
            </div>
          </TabsContent>

          {/* Mission defaults tab */}
          <TabsContent
            value="mission-defaults"
            className="px-5 pb-5 overflow-y-auto flex-1"
          >
            <div className="space-y-3 pt-2">
              <p className="text-[10px] text-muted-foreground">
                Tyto výchozí hodnoty se použijí při vytváření nových misí.
              </p>

              <div>
                <Label className="text-xs">Model dronu</Label>
                <Select
                  value={`${missionDefaults.droneEnumValue}-${missionDefaults.droneSubEnumValue}`}
                  onValueChange={(v) => {
                    const [drone, sub] = v.split("-").map(Number);
                    const model = DRONE_MODELS.find(
                      (d) =>
                        d.droneEnumValue === drone &&
                        d.droneSubEnumValue === sub,
                    );
                    if (model) {
                      setMissionDefault({
                        droneEnumValue: model.droneEnumValue,
                        droneSubEnumValue: model.droneSubEnumValue,
                        payloadEnumValue:
                          model.payloads[0]?.payloadEnumValue || 0,
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
                    value={String(missionDefaults.payloadEnumValue)}
                    onValueChange={(v) =>
                      setMissionDefault({ payloadEnumValue: parseInt(v) })
                    }
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
                    value={toDisplaySpeed(
                      missionDefaults.autoFlightSpeed,
                      unitSystem,
                    )}
                    onChange={(e) =>
                      setMissionDefault({
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
                    value={toDisplayHeight(
                      missionDefaults.takeOffSecurityHeight,
                      unitSystem,
                    )}
                    onChange={(e) =>
                      setMissionDefault({
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
                <Label className="text-xs">Max. baterie (min)</Label>
                <Input
                  type="number"
                  value={missionDefaults.maxBatteryMinutes}
                  onChange={(e) =>
                    setMissionDefault({
                      maxBatteryMinutes: Math.max(
                        1,
                        parseInt(e.target.value) || 1,
                      ),
                    })
                  }
                  min={1}
                  max={120}
                  step={1}
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <Label className="text-xs">Reference výšky</Label>
                <Select
                  value={missionDefaults.heightMode}
                  onValueChange={(v) =>
                    setMissionDefault({ heightMode: v as HeightMode })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relativeToStartPoint">
                      Relativně od startu
                    </SelectItem>
                    <SelectItem value="aboveGroundLevel">
                      Nad terénem (AGL)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Režim natočení</Label>
                <Select
                  value={missionDefaults.globalHeadingMode}
                  onValueChange={(v) =>
                    setMissionDefault({ globalHeadingMode: v as HeadingMode })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="followWayline">Podle trasy</SelectItem>
                    <SelectItem value="manually">Ruční</SelectItem>
                    <SelectItem value="fixed">Pevné</SelectItem>
                    <SelectItem value="smoothTransition">
                      Plynulý přechod
                    </SelectItem>
                    <SelectItem value="towardPOI">Směrem k POI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Režim přeletu</Label>
                <Select
                  value={missionDefaults.flyToWaylineMode}
                  onValueChange={(v) =>
                    setMissionDefault({
                      flyToWaylineMode: v as FlyToWaylineMode,
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="safely">
                      Bezpečně (nejdřív stoupání)
                    </SelectItem>
                    <SelectItem value="pointToPoint">
                      Přímo (bod k bodu)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Akce po dokončení</Label>
                <Select
                  value={missionDefaults.finishAction}
                  onValueChange={(v) =>
                    setMissionDefault({ finishAction: v as FinishAction })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="goHome">Návrat domů</SelectItem>
                    <SelectItem value="autoLand">
                      Automatické přistání
                    </SelectItem>
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
                  value={missionDefaults.executeRCLostAction}
                  onValueChange={(v) =>
                    setMissionDefault({
                      executeRCLostAction: v as RCLostAction,
                    })
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
                  value={toDisplaySpeed(
                    missionDefaults.globalTransitionalSpeed,
                    unitSystem,
                  )}
                  onChange={(e) =>
                    setMissionDefault({
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

              <Button
                onClick={savePreferences}
                className="w-full h-9 text-sm"
                disabled={prefsSaving}
              >
                {prefsSaving
                  ? "Ukládání..."
                  : prefsSaved
                    ? "Uloženo!"
                    : "Uložit výchozí nastavení"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
