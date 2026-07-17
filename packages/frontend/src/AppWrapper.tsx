import { useEffect, lazy, Suspense } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";
import { useConfigStore } from "@/store/configStore";
import { useAuthStore } from "@/store/authStore";
import { VerificationGate } from "@/components/auth/VerificationGate";

// Lazy: only a visitor who followed a password-reset link ever needs this
// page's code.
const ResetPasswordPage = lazy(() =>
  import("@/pages/ResetPasswordPage").then((m) => ({
    default: m.ResetPasswordPage,
  })),
);

/**
 * Password-reset links (`/reset-password?token=...`) must be reachable by a
 * signed-out visitor, so this is resolved before any sign-in gating rather
 * than through App's own `currentPage` routing (which only renders once
 * the user is authenticated or hits the public shared-mission page).
 */
function resolveResetPasswordToken(): string | null {
  if (window.location.pathname !== "/reset-password") return null;
  return new URLSearchParams(window.location.search).get("token");
}

export function AppWrapper() {
  const { selfHosted, googleClientId, loaded, fetchConfig } = useConfigStore();
  const { needsVerification, token } = useAuthStore();

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  if (!loaded) {
    return null;
  }

  const resetPasswordToken = resolveResetPasswordToken();
  if (resetPasswordToken) {
    return (
      <Suspense fallback={null}>
        <ResetPasswordPage token={resetPasswordToken} />
      </Suspense>
    );
  }

  const showVerificationGate = !selfHosted && token && needsVerification;

  // In cloud mode, wrap with GoogleOAuthProvider
  if (!selfHosted && googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        <App />
        {showVerificationGate && <VerificationGate />}
      </GoogleOAuthProvider>
    );
  }

  return (
    <>
      <App />
      {showVerificationGate && <VerificationGate />}
    </>
  );
}
