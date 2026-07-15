import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useAuthStore } from "@/store/authStore";
import { Shield } from "lucide-react";

export function VerificationGate() {
  const { googleLogin, email, logout } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setError(null);
    try {
      await googleLogin(credentialResponse.credential);
    } catch (err: any) {
      if (err.message?.includes("email")) {
        setError(
          `Přihlaste se prosím pomocí účtu Google odpovídajícího ${email}`,
        );
      } else {
        setError(err.message || "Přihlášení přes Google se nezdařilo");
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="bg-card border border-border rounded-lg shadow-[0_0_60px_rgba(59,130,246,0.3)] w-full max-w-md mx-4 p-8 text-center space-y-6">
        <div className="flex justify-center">
          <Shield className="h-12 w-12 text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Ověřte svůj účet</h2>
          <p className="text-sm text-muted-foreground">
            Pro pokračování v používání DroneRoute prosím ověřte svůj e-mail
            přihlášením přes Google.
          </p>
          {email && (
            <p className="text-xs text-muted-foreground">
              Použijte účet Google odpovídající{" "}
              <span className="font-medium text-foreground">{email}</span>
            </p>
          )}
        </div>

        <div className="flex justify-center">
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={() => setError("Přihlášení přes Google se nezdařilo")}
            theme="filled_black"
            size="large"
            width="320"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-primary transition-colors"
          onClick={logout}
        >
          Místo toho se odhlásit
        </button>
      </div>
    </div>
  );
}
