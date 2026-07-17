## Summary

A short guided tour for first-time visitors, spotlighting the main editor's key areas.

## Changes

- New `onboardingStore` (Zustand) drives a 4-step tour: map area, map toolbar, sidebar sections, save/export toolbar — each step spotlights the real element via `data-tour` attributes added to `App.tsx`/`MapToolbar.tsx`.
- New `OnboardingTour` component renders the spotlight (a CSS box-shadow cutout around the target) and a positioned tooltip card with Zpět/Další/Dokončit controls; falls back to a plain dimmed overlay if a step's target isn't currently mounted (e.g. sidebar hidden).
- `WelcomeDialog`'s single "Začít" button is now two options: "Přeskočit" or "Spustit prohlídku" — starting the tour or skipping it both mark onboarding as seen, matching the existing one-time-dialog behavior.
- The tour can be replayed anytime via a new "Spustit prohlídku aplikace" link in the help dialog (AboutDialog).
