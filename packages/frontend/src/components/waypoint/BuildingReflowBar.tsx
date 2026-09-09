import { Building2, Check, X, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { heightLabel, toDisplayHeight } from "@/lib/units";
import { useBuildingReflowProposal } from "@/hooks/useBuildingReflowProposal";

/**
 * The confirmation for a building edit that would move waypoints.
 *
 * Nothing about the route changes until the operator presses "Použít" —
 * changing a footprint is a routine act of keeping the plan honest, and
 * silently dragging the flight along with it would mean discovering the
 * damage only after the aircraft has flown it. The bar names the numbers
 * that decide the call: how far the recommended standoff moved, how many
 * waypoints would follow, and how many are pinned to footage already shot.
 */
export function BuildingReflowBar() {
  const proposal = useBuildingReflowProposal();
  const applyBuildingReflow = useMissionStore((s) => s.applyBuildingReflow);
  const dismissBuildingReflow = useMissionStore((s) => s.dismissBuildingReflow);
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  // BulkActionToolbar owns the bottom-centre slot whenever a multi-selection
  // is live, and both bars can legitimately be open at once — locking a batch
  // leaves it selected. Stack rather than overlap.
  const bulkToolbarVisible = useMissionStore(
    (s) => s.selectedWaypointIndices.size >= 2,
  );

  if (!proposal || proposal.movedCount === 0) return null;

  const unit = heightLabel(unitSystem);
  const oldRadius = toDisplayHeight(proposal.oldRadiusM, unitSystem);
  const newRadius = toDisplayHeight(proposal.newRadiusM, unitSystem);

  const handleApply = () => {
    applyBuildingReflow(proposal.moves);
    toast.success(
      `Přepočítáno ${proposal.movedCount} bodů${
        proposal.lockedCount > 0
          ? `, ${proposal.lockedCount} zamčených zůstalo na místě`
          : ""
      }`,
    );
  };

  return (
    <div
      // Capped to the viewport and scrolled inside, same as BulkActionToolbar:
      // the radius readout plus two badges plus two buttons is wider than a
      // phone, and Použít/Zrušit must stay reachable.
      className={`fixed ${
        bulkToolbarVisible ? "bottom-24" : "bottom-6"
      } left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-1rem)] animate-in slide-in-from-bottom-4 fade-in duration-200 tabular-nums`}
    >
      <div className="bg-card border border-amber-400/40 rounded-xl shadow-2xl shadow-black/30 overflow-hidden max-w-full">
        <div className="flex items-center gap-3 px-4 py-2.5 overflow-x-auto">
          <Building2 className="h-4 w-4 text-amber-400 shrink-0" />
          <div className="text-xs whitespace-nowrap">
            <div className="font-medium">Budova změněna</div>
            <div className="text-muted-foreground">
              Doporučený odstup {oldRadius} → {newRadius} {unit}
            </div>
          </div>

          <div className="h-4 w-px bg-border" />

          <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
            Posune se: {proposal.movedCount}
          </Badge>
          {proposal.lockedCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] px-2 py-0.5 gap-1 border-amber-400/50 text-amber-400"
            >
              <Lock className="h-2.5 w-2.5" />
              Zamčeno: {proposal.lockedCount}
            </Badge>
          )}

          <div className="h-4 w-px bg-border" />

          <Button
            size="sm"
            onClick={handleApply}
            className="h-7 text-xs gap-1.5 px-2"
            title="Posunout odemčené body podle nového půdorysu"
          >
            <Check className="h-3 w-3" />
            Použít
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={dismissBuildingReflow}
            className="h-7 text-xs gap-1.5 px-2"
            title="Nechat body tam, kde jsou — budova zůstane změněná"
          >
            <X className="h-3 w-3" />
            Zrušit
          </Button>
        </div>
      </div>
    </div>
  );
}
