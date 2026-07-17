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

type AuthMode = "login" | "twoFactor" | "forgotPassword";

export function AuthModal({ onClose }: AuthModalProps) {
  const {
    login,
    loginWithTwoFactorCode,
    cancelTwoFactorChallenge,
    googleLogin,
    forgotPassword,
    isLoading,
  } = useAuthStore();
  const { selfHosted } = useConfigStore();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const result = await login(email, password);
      if (result.requiresTwoFactor) {
        setMode("twoFactor");
        return;
      }
      onClose();
    } catch (err: any) {
      setError(err.message || "Něco se pokazilo");
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await loginWithTwoFactorCode(twoFactorCode);
      onClose();
    } catch (err: any) {
      setError(err.message || "Neplatný kód");
    }
  };

  const handleBackFromTwoFactor = () => {
    cancelTwoFactorChallenge();
    setTwoFactorCode("");
    setError(null);
    setMode("login");
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setForgotLoading(true);
    try {
      await forgotPassword(forgotEmail);
      setForgotSubmitted(true);
    } catch (err: any) {
      setError(err.message || "Něco se pokazilo");
    } finally {
      setForgotLoading(false);
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
            {mode === "twoFactor"
              ? "Dvoufázové ověření"
              : mode === "forgotPassword"
                ? "Obnovení hesla"
                : selfHosted
                  ? "Přihlásit se"
                  : "Přihlásit se přes Google"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {mode === "twoFactor" ? (
            <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Zadejte 6místný kód z vaší aplikace pro ověřování.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="twoFactorCode" className="text-xs">
                  Ověřovací kód
                </Label>
                <Input
                  id="twoFactorCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  placeholder="123456"
                  className="h-9 text-sm"
                  required
                  autoFocus
                />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button
                type="submit"
                className="w-full h-9 text-sm"
                disabled={isLoading}
              >
                {isLoading ? "..." : "Potvrdit"}
              </Button>
              <button
                type="button"
                onClick={handleBackFromTwoFactor}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Zpět na přihlášení
              </button>
            </form>
          ) : mode === "forgotPassword" ? (
            <>
              {forgotSubmitted ? (
                <div className="space-y-3 text-center">
                  <p className="text-xs text-emerald-400">
                    Pokud tento e-mail existuje, byl na něj odeslán odkaz pro
                    obnovení hesla.
                  </p>
                  <button
                    type="button"
                    onClick={() => setMode("login")}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Zpět na přihlášení
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Zadejte svůj e-mail a pošleme vám odkaz pro obnovení hesla.
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="forgotEmail" className="text-xs">
                      E-mail
                    </Label>
                    <Input
                      id="forgotEmail"
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="h-9 text-sm"
                      required
                      autoFocus
                    />
                  </div>

                  {error && <p className="text-xs text-destructive">{error}</p>}

                  <Button
                    type="submit"
                    className="w-full h-9 text-sm"
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? "..." : "Odeslat odkaz"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMode("login");
                    }}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Zpět na přihlášení
                  </button>
                </form>
              )}
            </>
          ) : selfHosted ? (
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
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-xs">
                      Heslo
                    </Label>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setForgotEmail(email);
                        setForgotSubmitted(false);
                        setMode("forgotPassword");
                      }}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Zapomenuté heslo?
                    </button>
                  </div>
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
