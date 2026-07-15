import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/authStore";
import { useConfigStore } from "@/store/configStore";
import { X } from "lucide-react";

interface AuthModalProps {
  onClose: () => void;
}

export function AuthModal({ onClose }: AuthModalProps) {
  const { login, googleLogin, isLoading } = useAuthStore();
  const { selfHosted } = useConfigStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      onClose();
    } catch (err: any) {
      setError(err.message || "Něco se pokazilo");
    }
  };

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setError(null);
    try {
      await googleLogin(credentialResponse.credential);
      onClose();
    } catch (err: any) {
      setError(err.message || "Přihlášení přes Google se nezdařilo");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-[0_0_60px_rgba(0,194,255,0.25)] w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">
            {selfHosted ? "Přihlásit se" : "Přihlásit se přes Google"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {selfHosted ? (
            <>
              {/* Self-hosted: email + password form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs">
                    E-mail
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="h-9 text-sm"
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs">
                    Heslo
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-9 text-sm"
                    required
                  />
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}

                <Button
                  type="submit"
                  className="w-full h-9 text-sm"
                  disabled={isLoading}
                >
                  {isLoading ? "..." : "Přihlásit se"}
                </Button>
              </form>
            </>
          ) : (
            <>
              {/* Cloud: Google OAuth only */}
              <p className="text-xs text-muted-foreground text-center">
                Přihlaste se nebo si vytvořte účet pomocí účtu Google.
              </p>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() =>
                    setError("Přihlášení přes Google se nezdařilo")
                  }
                  theme="filled_black"
                  size="large"
                  width="320"
                />
              </div>
              {error && (
                <p className="text-xs text-destructive text-center">{error}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
