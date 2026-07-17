import { useEffect } from "react";
import { X, BookOpen, ShieldCheck, TriangleAlert, Globe } from "lucide-react";

interface AboutDialogProps {
  onClose: () => void;
}

/** Kept in sync with specs/keyboard-shortcuts.md and the switch statement
 * in App.tsx's global keyboard handler — this is the in-app equivalent of
 * that doc, shown directly instead of only linking out to GUIDE.md. */
const SHORTCUTS: { key: string; description: string }[] = [
  { key: "W", description: "Režim přidávání bodů trasy" },
  { key: "P", description: "Režim přidávání POI" },
  { key: "O", description: "Šablona orbit" },
  { key: "G", description: "Šablona mřížkový průzkum" },
  { key: "F", description: "Šablona sken fasády" },
  { key: "Z", description: "Šablona volná křivka" },
  { key: "S", description: "Šablona solární panelový průzkum" },
  { key: "L", description: "Šablona liniová stavba" },
  { key: "T", description: "Šablona inspekce listů turbíny" },
  { key: "B", description: "Kreslení překážky" },
  { key: "H", description: "Kreslení budovy" },
  { key: "M", description: "Měřicí nástroj" },
  { key: "A", description: "Vrstva vzdušného prostoru" },
  { key: "Tab", description: "Skrýt/zobrazit boční panel" },
  { key: "Esc", description: "Zrušit akci / zrušit výběr" },
  { key: "Delete", description: "Smazat vybraný bod trasy, POI nebo překážku" },
  { key: "Ctrl+A", description: "Vybrat všechny body trasy" },
  { key: "Ctrl+Z", description: "Zpět" },
  { key: "Ctrl+Shift+Z", description: "Znovu" },
];

export function AboutDialog({ onClose }: AboutDialogProps) {
  // Close on Escape key — use capture phase so this fires before global shortcuts
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

  const sha = typeof __COMMIT_SHA__ !== "undefined" ? __COMMIT_SHA__ : "dev";
  const version =
    typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-[0_0_60px_rgba(0,194,255,0.25)] w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0">
          <div className="flex items-center gap-2.5">
            <img src="/skyroute-icon.svg" alt="SkyRoute" className="h-7 w-7" />
            <h2 className="text-base font-bold">SkyRoute</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pt-4 pb-2 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Plánovač misí pro drony DJI od firmy SkyData. Umísťujte body trasy
            na mapě, nastavujte parametry letu a exportujte soubory KMZ
            připravené k letu.
          </p>

          {/* Version */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Verze</span>
            <span className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border">
              v{version}
            </span>
            <span className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border">
              {sha}
            </span>
          </div>

          {/* Keyboard shortcuts */}
          <div className="pt-1">
            <h3 className="text-xs font-semibold text-foreground mb-1.5">
              Klávesové zkratky
            </h3>
            <div className="max-h-48 overflow-y-auto rounded border border-border">
              <table className="w-full text-xs">
                <tbody>
                  {SHORTCUTS.map(({ key, description }) => (
                    <tr
                      key={key}
                      className="border-b border-border last:border-0"
                    >
                      <td className="py-1 pl-2 pr-2 w-28 shrink-0">
                        <kbd className="font-mono text-[10px] font-bold border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 rounded text-foreground/80">
                          {key}
                        </kbd>
                      </td>
                      <td className="py-1 pr-2 text-muted-foreground">
                        {description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Zkratky fungují jen mimo textová pole.
            </p>
          </div>

          {/* Links */}
          <div className="flex flex-col gap-2 pt-1">
            <a
              href="https://www.skydata.cz"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Globe className="h-4 w-4 shrink-0" />
              skydata.cz — web firmy SkyData
            </a>
            <a
              href="https://github.com/ProsteDav3/droneroute/blob/main/GUIDE.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <BookOpen className="h-4 w-4 shrink-0" />
              Uživatelská příručka — funkce, zkratky a tipy
            </a>
            <a
              href="https://github.com/ProsteDav3/droneroute/blob/main/PRIVACY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Soukromí a data — co ukládáme a kde
            </a>
          </div>

          {/* Disclaimer */}
          <div className="flex gap-2 pt-2 border-t border-border">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <span className="text-amber-500 font-medium">Aktivní vývoj.</span>{" "}
              Poskytováno "tak, jak je" bez záruky. Autoři neodpovídají za žádné
              škody na vašich dronech, vybavení nebo majetku. Před letem vždy
              ověřte parametry mise.
            </p>
          </div>
        </div>

        {/* Footer spacer */}
        <div className="px-5 py-3" />
      </div>
    </div>
  );
}
