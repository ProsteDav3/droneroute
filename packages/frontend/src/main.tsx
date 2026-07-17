import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { AppWrapper } from "./AppWrapper";
import { ErrorFallback } from "./components/ErrorFallback";
import { initSentry, Sentry } from "@/lib/sentry";
import "./index.css";

initSentry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <AppWrapper />
      <Toaster theme="dark" position="bottom-center" richColors />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
