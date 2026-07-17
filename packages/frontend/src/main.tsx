import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
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
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <AppWrapper />
      <Toaster theme="dark" position="bottom-center" richColors />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
