import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Top-level error boundary fallback (see main.tsx). Reloading is the only
 * offered recovery — the app has no per-section boundaries, so any error
 * caught here means the whole component tree already unmounted, and a
 * targeted "try again" wouldn't have anything to retry into.
 */
export function ErrorFallback() {
  return (
    <div className="flex h-dvh w-screen flex-col items-center justify-center gap-4 bg-background text-center px-6">
      <AlertTriangle className="h-10 w-10 text-amber-400" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Něco se pokazilo</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Aplikace narazila na neočekávanou chybu. Zkuste stránku znovu načíst —
          pokud rozpracovaná mise nebyla uložena, autosave draft by ji měl
          obnovit.
        </p>
      </div>
      <Button onClick={() => window.location.reload()}>
        Znovu načíst stránku
      </Button>
    </div>
  );
}
