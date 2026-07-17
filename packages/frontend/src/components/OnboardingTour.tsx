import { useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnboardingStore, TOUR_STEPS } from "@/store/onboardingStore";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** A guided walkthrough of the main editor, spotlighting one real UI element
 * per step (see the `data-tour` attributes in App.tsx/MapToolbar.tsx). Only
 * ever started explicitly — from WelcomeDialog on first visit, or replayed
 * later from AboutDialog — never auto-triggered on every load. */
export function OnboardingTour() {
  const { active, stepIndex, next, prev, stop } = useOnboardingStore();
  const [rect, setRect] = useState<Rect | null>(null);
  const step = TOUR_STEPS[stepIndex];

  useLayoutEffect(() => {
    if (!active || !step) return;

    const measure = () => {
      const el = document.querySelector(step.selector);
      if (!el) {
        setRect(null);
        return;
      }
      const box = el.getBoundingClientRect();
      setRect({
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      });
    };

    measure();
    window.addEventListener("resize", measure);
    // The target may animate into place (e.g. a section expanding) or the
    // layout may settle a frame late — one deferred re-measure covers both
    // without needing a full ResizeObserver/MutationObserver setup.
    const timer = window.setTimeout(measure, 50);
    return () => {
      window.removeEventListener("resize", measure);
      window.clearTimeout(timer);
    };
  }, [active, step]);

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, stop]);

  if (!active || !step) return null;

  const isLast = stepIndex === TOUR_STEPS.length - 1;

  // Position the tooltip card below the target when there's room, otherwise
  // above it; centered above/below on narrow viewports isn't attempted —
  // the card clamps to stay on-screen instead.
  const cardWidth = 320;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardTop = rect
    ? rect.top + rect.height + 12 + 160 < viewportHeight
      ? rect.top + rect.height + 12
      : Math.max(12, rect.top - 12 - 160)
    : viewportHeight / 2 - 80;
  const cardLeft = rect
    ? Math.min(
        Math.max(12, rect.left + rect.width / 2 - cardWidth / 2),
        viewportWidth - cardWidth - 12,
      )
    : viewportWidth / 2 - cardWidth / 2;

  return (
    <div className="fixed inset-0 z-[2000]">
      {/* Spotlight cutout: a transparent rect around the target, dimming
          everything else via a giant box-shadow instead of an SVG mask —
          simplest way to punch a "hole" with plain CSS. Falls back to a
          plain dim overlay (no cutout) when the target isn't currently
          mounted, e.g. sidebar hidden on mobile. */}
      {rect ? (
        <div
          className="fixed rounded-md transition-all duration-200 pointer-events-none"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.65)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/65" />
      )}

      <div
        className="fixed rounded-lg border border-border bg-card shadow-[0_0_40px_rgba(0,194,255,0.25)] p-4 text-sm"
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
      >
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <h3 className="font-semibold text-foreground">{step.title}</h3>
          <button
            onClick={stop}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Ukončit prohlídku"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-muted-foreground text-xs leading-relaxed mb-3">
          {step.body}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {stepIndex + 1} / {TOUR_STEPS.length}
          </span>
          <div className="flex gap-1.5">
            {stepIndex > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={prev}
              >
                Zpět
              </Button>
            )}
            <Button size="sm" className="h-7 text-xs px-2.5" onClick={next}>
              {isLast ? "Dokončit" : "Další"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
