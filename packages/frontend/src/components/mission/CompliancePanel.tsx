import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlightLogPanel } from "@/components/mission/FlightLogPanel";
import { RiskAssessmentPanel } from "@/components/mission/RiskAssessmentPanel";
import { PermitsPanel } from "@/components/mission/PermitsPanel";

/**
 * Compliance tools for a mission: flight logbook, SORA-lite risk assessment,
 * and permit/authorization tracking (items 5 and 6). Not wired into
 * App.tsx's sidebar — see the PR notes for the one-line addition
 * ("compliance" entry in `SidebarSection` + a rendered `<CompliancePanel />`
 * next to the existing "weather" section) that would surface this tab.
 */
export function CompliancePanel() {
  return (
    <Tabs defaultValue="flight-log" className="w-full">
      <TabsList className="w-full grid grid-cols-3">
        <TabsTrigger value="flight-log">Letový deník</TabsTrigger>
        <TabsTrigger value="risk">Rizika</TabsTrigger>
        <TabsTrigger value="permits">Povolení</TabsTrigger>
      </TabsList>
      <TabsContent value="flight-log">
        <FlightLogPanel />
      </TabsContent>
      <TabsContent value="risk">
        <RiskAssessmentPanel />
      </TabsContent>
      <TabsContent value="permits">
        <PermitsPanel />
      </TabsContent>
    </Tabs>
  );
}
