import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/authStore";

interface ResetPasswordPageProps {
  token: string;
}

/**
 * Standalone public page for `/reset-password?token=...` links emailed (or
 * console-logged, see routes/auth.ts) by the forgot-password flow. Rendered
 * directly by AppWrapper based on the URL, independent of the app's own
 * sign-in state — a signed-out visitor must be able to reach this page.
 */
export function ResetPasswordPage({ token }: ResetPasswordPageProps) {
  const { resetPassword } = useAuthStore();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Nová hesla se neshodují");
      return;
    }
    if (newPassword.length < 6) {
      setError("Nové heslo musí mít alespoň 6 znaků");
      return;
    }

    setSaving(true);
    try {
      await resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Obnovení hesla se nezdařilo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-6">
          <img src="/skyroute-icon.svg" alt="SkyRoute" className="h-10 w-10" />
          <h1 className="text-lg font-semibold">SkyRoute</h1>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-[0_0_60px_rgba(0,194,255,0.25)] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-center">Obnovení hesla</h2>

          {success ? (
            <div className="space-y-3 text-center">
              <p className="text-xs text-emerald-400">
                Heslo bylo úspěšně změněno. Nyní se prosím přihlaste novým
                heslem.
              </p>
              <Button
                className="w-full h-9 text-sm"
                onClick={() => {
                  window.location.href = "/";
                }}
              >
                Přejít na přihlášení
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-new-password" className="text-xs">
                  Nové heslo
                </Label>
                <Input
                  id="reset-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 6 znaků"
                  className="h-9 text-sm"
                  required
                  minLength={6}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-confirm-password" className="text-xs">
                  Potvrzení nového hesla
                </Label>
                <Input
                  id="reset-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-9 text-sm"
                  required
                  minLength={6}
                />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button
                type="submit"
                className="w-full h-9 text-sm"
                disabled={saving}
              >
                {saving ? "..." : "Nastavit nové heslo"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
