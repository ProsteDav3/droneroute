import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function useIsOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Shown whenever the browser reports no network connection. The app shell
 * itself still loads offline (see vite.config.ts's service worker), but
 * every save/load/API-backed feature needs a live connection — this makes
 * that limitation visible instead of leaving failed requests unexplained.
 */
export function OfflineBanner() {
  const isOnline = useIsOnline();
  if (isOnline) return null;

  return (
    <div
      // top-16 rather than top-4: DraftRecoveryBanner already occupies top-4
      // in the same corner, and the two can plausibly show at once (a
      // crashed-tab recovery while offline).
      className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-md border border-amber-500/30 bg-background/95 backdrop-blur-sm px-3 py-2 text-xs shadow-lg"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-amber-500" />
      <span className="text-muted-foreground">
        Bez připojení k internetu — ukládání, nahrávání a data ze serveru
        (počasí, vzdušný prostor...) momentálně nejsou dostupná.
      </span>
    </div>
  );
}
