import { create } from "zustand";

const STORAGE_KEY = "droneroute_tour_completed";

export interface TourStep {
  /** CSS selector for the element to spotlight — see the `data-tour`
   * attributes added to App.tsx/MapToolbar.tsx. */
  selector: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="map-area"]',
    title: "Mapa je vaše pracovní plocha",
    body: "Klikněte kamkoli na mapu pro přidání bodu trasy. Vše, co uděláte — body trasy, POI, překážky, šablony — se odehrává přímo tady.",
  },
  {
    selector: '[data-tour="map-toolbar"]',
    title: "Nástroje mapy",
    body: "Přepínejte mezi režimem bodů trasy, POI a šablonami letových vzorů (orbit, mřížka, sken fasády...).",
  },
  {
    selector: '[data-tour="sidebar-sections"]',
    title: "Přehled mise",
    body: "Seznamy bodů trasy, POI a překážek, nastavení mise a předpověď počasí najdete v postranním panelu.",
  },
  {
    selector: '[data-tour="save-toolbar"]',
    title: "Uložení a export",
    body: "Uložte misi do svého účtu, nebo ji rovnou exportujte jako soubor KMZ připravený k nahrání do DJI dronu.",
  },
];

interface OnboardingState {
  active: boolean;
  stepIndex: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  active: false,
  stepIndex: 0,
  start: () => set({ active: true, stepIndex: 0 }),
  next: () => {
    const { stepIndex } = get();
    if (stepIndex >= TOUR_STEPS.length - 1) {
      localStorage.setItem(STORAGE_KEY, "1");
      set({ active: false, stepIndex: 0 });
    } else {
      set({ stepIndex: stepIndex + 1 });
    }
  },
  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  stop: () => {
    localStorage.setItem(STORAGE_KEY, "1");
    set({ active: false, stepIndex: 0 });
  },
}));

/** Whether the tour has already been completed or explicitly skipped —
 * checked once at app start (see WelcomeDialog) to decide whether to offer
 * it, matching the existing `droneroute_welcome_dismissed` pattern. */
export function hasTourCompleted(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}
