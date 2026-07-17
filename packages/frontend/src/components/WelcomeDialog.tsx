import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnboardingStore } from "@/store/onboardingStore";

const STORAGE_KEY = "droneroute_welcome_dismissed";

export function WelcomeDialog() {
  const [visible, setVisible] = useState(false);
  const startTour = useOnboardingStore((s) => s.start);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  };

  // Close on Escape key
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={dismiss}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-[0_0_60px_rgba(0,194,255,0.25)] w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0">
          <div className="flex items-center gap-2.5">
            <img src="/skyroute-icon.svg" alt="SkyRoute" className="h-7 w-7" />
            <h2 className="text-base font-bold">Vítejte v SkyRoute</h2>
          </div>
          <button
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pt-4 pb-2 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Plánovač misí pro drony DJI. Umísťujte body trasy na mapě,
            nastavujte parametry letu a exportujte soubory KMZ připravené k
            letu.
          </p>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rychlý start
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border border-border">
                  W
                </kbd>
                Přidat bod trasy
              </span>
              <span className="flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border border-border">
                  P
                </kbd>
                Přidat POI
              </span>
              <span className="flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border border-border">
                  O
                </kbd>
                Šablona orbitu
              </span>
              <span className="flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border border-border">
                  G
                </kbd>
                Mřížkový průzkum
              </span>
              <span className="flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border border-border">
                  Esc
                </kbd>
                Zrušit / odznačit
              </span>
              <span className="flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border border-border">
                  Del
                </kbd>
                Odebrat vybrané
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={dismiss}
            className="flex-1 h-9 text-sm"
          >
            Přeskočit
          </Button>
          <Button
            onClick={() => {
              dismiss();
              startTour();
            }}
            className="flex-1 h-9 text-sm"
          >
            Spustit prohlídku
          </Button>
        </div>
      </div>
    </div>
  );
}
