import { useEffect, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/authStore";
import { useConfigStore } from "@/store/configStore";
import { api } from "@/lib/api";

/**
 * Gates the entire app behind sign-in. Self-hosted deployments start with no
 * accounts, so the very first submission here bootstraps the founder/admin
 * account (see GET /api/auth/status); every submission after that is a
 * regular sign-in, and further accounts can only be created by that admin.
 */
export function LoginGate() {
  const { login, register, googleLogin, isLoading } = useAuthStore();
  const { selfHosted } = useConfigStore();
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(
    null,
  );
  const [requiresBootstrapToken, setRequiresBootstrapToken] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ registrationOpen: boolean; requiresBootstrapToken: boolean }>(
        "/auth/status",
      )
      .then((res) => {
        setRegistrationOpen(res.registrationOpen);
        setRequiresBootstrapToken(res.requiresBootstrapToken);
      })
      .catch(() => setRegistrationOpen(false));
  }, []);

  const isBootstrap = selfHosted && registrationOpen === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isBootstrap) {
        await register(email, password, token || undefined);
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    }
  };

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setError(null);
    try {
      await googleLogin(credentialResponse.credential);
    } catch (err: any) {
      setError(err.message || "Google sign-in failed");
    }
  };

  if (registrationOpen === null) {
    return <div className="fixed inset-0 bg-background" />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-6">
          <img src="/droneroute.png" alt="DroneRoute" className="h-8 w-8" />
          <h1 className="text-lg font-semibold">DroneRoute</h1>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-[0_0_60px_rgba(59,130,246,0.3)] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-center">
            {isBootstrap
              ? "Create the admin account"
              : selfHosted
                ? "Sign in"
                : "Sign in with Google"}
          </h2>
          {isBootstrap && (
            <p className="text-xs text-muted-foreground text-center">
              No account exists yet. The first account you create here becomes
              the admin, and registration closes afterward.
            </p>
          )}

          {selfHosted ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="gate-email" className="text-xs">
                  Email
                </Label>
                <Input
                  id="gate-email"
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
                <Label htmlFor="gate-password" className="text-xs">
                  Password
                </Label>
                <Input
                  id="gate-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isBootstrap ? "Min 6 characters" : ""}
                  className="h-9 text-sm"
                  required
                  minLength={isBootstrap ? 6 : undefined}
                />
              </div>

              {isBootstrap && requiresBootstrapToken && (
                <div className="space-y-1.5">
                  <Label htmlFor="gate-token" className="text-xs">
                    Bootstrap token
                  </Label>
                  <Input
                    id="gate-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="h-9 text-sm"
                    required
                  />
                </div>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button
                type="submit"
                className="w-full h-9 text-sm"
                disabled={isLoading}
              >
                {isLoading ? "..." : isBootstrap ? "Create account" : "Sign in"}
              </Button>
            </form>
          ) : (
            <>
              <p className="text-xs text-muted-foreground text-center">
                Sign in using your Google account.
              </p>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError("Google sign-in failed")}
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
