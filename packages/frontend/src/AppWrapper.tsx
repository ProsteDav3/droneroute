import { useEffect } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";
import { useConfigStore } from "@/store/configStore";
import { useAuthStore } from "@/store/authStore";
import { VerificationGate } from "@/components/auth/VerificationGate";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";

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
    return <ResetPasswordPage token={resetPasswordToken} />;
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
