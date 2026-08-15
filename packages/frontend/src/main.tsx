import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import { registerSW } from "virtual:pwa-register";
import { AppWrapper } from "./AppWrapper";
import { ErrorFallback } from "./components/ErrorFallback";
import { initSentry, Sentry } from "@/lib/sentry";
import "./index.css";

initSentry();

// Precaches the static app shell so the editor's UI loads without a network
// connection — see vite.config.ts for why API responses are deliberately
// never cached. No-op in dev and in the Playwright E2E suite (both run
// without a production build, so there's no service worker to register).
//
// A new deploy is downloaded in the background but only takes over on the
// next real page load — and while any tab still holds the old worker, even
// a reload keeps serving the old shell. Left silent, that meant a user
// planned and flew missions for hours against a panel that no longer
// matched the deployed app (fields they'd been told existed weren't
// there). So: say so, and offer the reload. `updateSW(true)` tells the
// waiting worker to skip waiting and reloads once it has taken control.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    toast("Je k dispozici nová verze SkyRoute", {
      description:
        "Obnovte stránku, ať pracujete s aktuálním rozhraním — rozdělaná mise zůstane zachována v konceptu.",
      duration: Infinity,
      action: {
        label: "Obnovit",
        onClick: () => {
          void updateSW(true);
        },
      },
    });
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <AppWrapper />
      <Toaster theme="dark" position="bottom-center" richColors />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
