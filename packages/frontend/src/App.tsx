import { useState, useRef, useEffect, lazy, Suspense } from "react";
import type mapboxgl from "mapbox-gl";
import { Loader2, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MapView } from "@/components/map/MapView";
import { BulkActionToolbar } from "@/components/waypoint/BulkActionToolbar";
import { useTemplatePresetsStore } from "@/store/templatePresetsStore";
// Lazy-loaded: each of these is its own route-like view, rendered exclusively
// of the main editor (see the `currentPage` branches below) and of each
// other, so splitting them out of the main chunk means a visitor who only
// ever opens the editor never downloads the admin panel, the routes list, or
// the public share-view code.
const RoutesPage = lazy(() =>
  import("@/components/routes/RoutesPage").then((m) => ({
    default: m.RoutesPage,
  })),
);
const SharedMissionPage = lazy(() =>
  import("@/components/routes/SharedMissionPage").then((m) => ({
    default: m.SharedMissionPage,
  })),
);
const EmbedMissionPage = lazy(() =>
  import("@/components/routes/EmbedMissionPage").then((m) => ({
    default: m.EmbedMissionPage,
  })),
);
const AdminPage = lazy(() =>
  import("@/pages/AdminPage").then((m) => ({ default: m.AdminPage })),
);
import { WarningsPanel } from "@/components/mission/WarningsPanel";
import { UndoRedoControls } from "@/components/mission/UndoRedoControls";
import { DraftRecoveryBanner } from "@/components/mission/DraftRecoveryBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { MissionProgressPanel } from "@/components/mission/MissionProgressPanel";
import { FlightSimulationPanel } from "@/components/mission/FlightSimulationPanel";
import { AuthModal } from "@/components/auth/AuthModal";
import { LoginGate } from "@/components/auth/LoginGate";
import { AccountModal } from "@/components/auth/AccountModal";
import { AboutDialog } from "@/components/AboutDialog";
import { WelcomeDialog } from "@/components/WelcomeDialog";
import { OnboardingTour } from "@/components/OnboardingTour";
import {
  AppSidebar,
  type SidebarSection,
} from "@/components/layout/AppSidebar";
import { useMissionStore } from "@/store/missionStore";
import { useAuthStore } from "@/store/authStore";
import { useConfigStore } from "@/store/configStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { useMissionFileActions } from "@/hooks/useMissionFileActions";
import { useGlobalKeyboardShortcuts } from "@/hooks/useGlobalKeyboardShortcuts";
import { useMissionWarnings } from "@/hooks/useMissionWarnings";

/** Fallback shown while a lazy-loaded page chunk (admin, routes list,
 * shared/embed view) downloads. Brief on a warm cache; only visible long
 * enough to matter on a cold load or slow connection. */
function PageLoadingFallback() {
  return (
    <div className="flex h-dvh w-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function App() {
  const {
    missionName,
    setMissionName,
    missionClient,
    setMissionClient,
    missionId,
    setMissionId,
    config,
    waypoints,
    pois,
    obstacles,
    buildings,
    templateGroups,
    currentPage,
    setCurrentPage,
    shareToken,
    setShareToken,
    dirty,
    setDirty,
  } = useMissionStore();

  const [expandedSections, setExpandedSections] = useState<
    Record<SidebarSection, boolean>
  >({
    waypoints: true,
    pois: false,
    obstacles: false,
    buildings: false,
    presets: false,
    weather: false,
    config: false,
  });

  // Hides the sidebar for a fullscreen map view — Tab toggles it (see the
  // keyboard shortcut handler below). Deliberately local component state,
  // not persisted preferences or mission-store: purely a transient view
  // toggle for the current session. Defaults to hidden on narrow viewports
  // (the sidebar renders as a full overlay drawer below the `md` breakpoint,
  // see the sidebar's className below) so a phone-sized screen opens
  // straight into the map instead of the drawer covering it.
  const [panelsHidden, setPanelsHidden] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const {
    token,
    email: userEmail,
    logout,
    restore,
    isAdmin,
    hasRestored,
  } = useAuthStore();
  const { selfHosted, djiCloudEnabled } = useConfigStore();
  const [gravatarUrl, setGravatarUrl] = useState<string | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // Restore auth session on mount
  useEffect(() => {
    restore();
  }, []);

  // Fetch user preferences after auth is restored
  const { fetchPreferences, preferences } = usePreferencesStore();
  const unitSystem = preferences.unitSystem;
  useEffect(() => {
    if (token) {
      fetchPreferences();
    }
  }, [token]);

  // Apply the color theme preference to the document root — index.css
  // defines the light palette under :root[data-theme="light"], falling
  // back to the app's default dark theme when unset.
  const colorTheme = preferences.visualization?.colorTheme;
  useEffect(() => {
    if (colorTheme === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
  }, [colorTheme]);

  // Fetch saved template presets after auth is restored
  const { presets, fetchPresets } = useTemplatePresetsStore();
  useEffect(() => {
    if (token) {
      fetchPresets();
    }
  }, [token]);

  // Detect /shared/:token or /embed/:token on mount — these don't need an
  // authenticated session, so they're resolved immediately.
  useEffect(() => {
    const match = window.location.pathname.match(/^\/shared\/([^/]+)$/);
    const embedMatch = window.location.pathname.match(/^\/embed\/([^/]+)$/);
    if (match) {
      setShareToken(match[1]);
      setCurrentPage("shared");
    } else if (embedMatch) {
      setShareToken(embedMatch[1]);
      setCurrentPage("embed");
    }
  }, []);

  // Detect /admin separately: whether the session is an admin one isn't
  // knowable synchronously anymore (the session cookie is httpOnly, so it
  // can only be confirmed by asking the backend — see authStore.ts's
  // `restore`), so this waits for that to resolve instead of reading
  // localStorage directly.
  useEffect(() => {
    if (!hasRestored) return;
    if (window.location.pathname !== "/admin") return;
    if (token && isAdmin) {
      setCurrentPage("admin");
    } else {
      window.history.replaceState({}, "", "/");
    }
  }, [hasRestored, token, isAdmin]);

  // Warn before closing/navigating away with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (
        dirty &&
        (waypoints.length > 1 ||
          pois.length > 0 ||
          obstacles.length > 0 ||
          buildings.length > 0)
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [
    dirty,
    waypoints.length,
    pois.length,
    obstacles.length,
    buildings.length,
  ]);

  const { warnings, flightStats, segmentsSummary } = useMissionWarnings({
    waypoints,
    obstacles,
    autoFlightSpeed: config.autoFlightSpeed,
    maxBatteryMinutes: config.maxBatteryMinutes,
  });

  // Compute Gravatar URL when email changes
  useEffect(() => {
    if (!userEmail) {
      setGravatarUrl(null);
      return;
    }
    const trimmed = userEmail.trim().toLowerCase();
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(trimmed))
      .then((buf) => {
        const hex = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        setGravatarUrl(`https://www.gravatar.com/avatar/${hex}?s=64&d=mp`);
      });
  }, [userEmail]);

  const toggleSection = (section: SidebarSection) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const {
    saving,
    exporting,
    exportingSegments,
    savingSegments,
    generatingReport,
    uploadingToDjiCloud,
    uploadingSegmentsToDjiCloud,
    handleSave,
    handleSaveSegments,
    handleExport,
    handleExportSegments,
    handleDownloadReport,
    handleExportPhotogrammetryCsv,
    handleUploadToDjiCloud,
    handleUploadSegmentsToDjiCloud,
    handleImport,
  } = useMissionFileActions({
    missionName,
    missionClient,
    missionId,
    setMissionId,
    config,
    waypoints,
    pois,
    obstacles,
    buildings,
    templateGroups,
    token,
    setShowAuthModal,
    setDirty,
    unitSystem,
    mapRef,
    fileInputRef,
  });

  useGlobalKeyboardShortcuts({ setPanelsHidden, setShowAbout });

  // The shared-mission page is intentionally public (that's the whole point
  // of a share link); everything else requires signing in. Wait for
  // hasRestored so a returning, already-logged-in user doesn't flash the
  // login screen before authStore's restore() confirms the session via the
  // httpOnly cookie (GET /api/auth/me).
  if (
    hasRestored &&
    !token &&
    currentPage !== "shared" &&
    currentPage !== "embed"
  ) {
    return <LoginGate />;
  }
  if (!hasRestored && currentPage !== "shared" && currentPage !== "embed") {
    return null;
  }

  // Show admin page
  if (currentPage === "admin") {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <AdminPage />
      </Suspense>
    );
  }

  // Show routes page
  if (currentPage === "routes") {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <RoutesPage onRequestAuth={() => setShowAuthModal(true)} />
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      </Suspense>
    );
  }

  // Show shared mission page
  if (currentPage === "shared" && shareToken) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <SharedMissionPage
          shareToken={shareToken}
          onRequestAuth={() => setShowAuthModal(true)}
        />
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      </Suspense>
    );
  }

  // Show the embeddable read-only map+route view (no editor chrome) — meant
  // to be loaded inside an <iframe> on a third-party page.
  if (currentPage === "embed" && shareToken) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <EmbedMissionPage shareToken={shareToken} />
      </Suspense>
    );
  }

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-background">
      {/* Sidebar — a fixed full-height overlay drawer below the `md`
          breakpoint (with a backdrop that closes it on tap), and a normal
          in-flow panel at `md` and above, matching desktop's existing
          layout exactly. */}
      {!panelsHidden && (
        <div
          className="fixed inset-0 z-[1500] bg-black/50 md:hidden"
          onClick={() => setPanelsHidden(true)}
          aria-hidden="true"
        />
      )}
      {!panelsHidden && (
        <AppSidebar
          missionName={missionName}
          setMissionName={setMissionName}
          missionClient={missionClient}
          setMissionClient={setMissionClient}
          setPanelsHidden={setPanelsHidden}
          setShowAbout={setShowAbout}
          setCurrentPage={setCurrentPage}
          selfHosted={selfHosted}
          isAdmin={isAdmin}
          handleSave={handleSave}
          saving={saving}
          handleExport={handleExport}
          exporting={exporting}
          handleImport={handleImport}
          fileInputRef={fileInputRef}
          handleDownloadReport={handleDownloadReport}
          generatingReport={generatingReport}
          handleExportPhotogrammetryCsv={handleExportPhotogrammetryCsv}
          djiCloudEnabled={djiCloudEnabled}
          handleUploadToDjiCloud={handleUploadToDjiCloud}
          uploadingToDjiCloud={uploadingToDjiCloud}
          handleUploadSegmentsToDjiCloud={handleUploadSegmentsToDjiCloud}
          uploadingSegmentsToDjiCloud={uploadingSegmentsToDjiCloud}
          handleExportSegments={handleExportSegments}
          exportingSegments={exportingSegments}
          handleSaveSegments={handleSaveSegments}
          savingSegments={savingSegments}
          segmentsSummary={segmentsSummary}
          config={config}
          waypoints={waypoints}
          flightStats={flightStats}
          unitSystem={unitSystem}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          poiCount={pois.length}
          obstacleCount={obstacles.length}
          buildingCount={buildings.length}
          presetCount={presets.length}
          mapRef={mapRef}
          gravatarUrl={gravatarUrl}
          userEmail={userEmail}
          token={token}
          setShowAccountMenu={setShowAccountMenu}
          logout={logout}
          setShowAuthModal={setShowAuthModal}
        />
      )}
      <div data-tour="map-area" className="flex-1 relative">
        {panelsHidden && (
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setPanelsHidden(false)}
            className="absolute top-3 left-3 z-20 h-8 w-8 bg-background/95 shadow-lg"
            title="Zobrazit panely (Tab)"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        )}
        <MapView onMapLoad={(map) => (mapRef.current = map)} />
        <UndoRedoControls />
        <DraftRecoveryBanner />
        <OfflineBanner />
        <MissionProgressPanel />
        <BulkActionToolbar />
        <WarningsPanel warnings={warnings} mapRef={mapRef} />
        <FlightSimulationPanel />
      </div>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showAccountMenu && (
        <AccountModal onClose={() => setShowAccountMenu(false)} />
      )}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      <WelcomeDialog />
      <OnboardingTour />
    </div>
  );
}
