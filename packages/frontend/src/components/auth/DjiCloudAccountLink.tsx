import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfigStore } from "@/store/configStore";
import { api } from "@/lib/api";

interface LinkStatus {
  linked: boolean;
  username?: string;
  linkedAt?: string;
}

function formatLinkedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("cs-CZ", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Lets a user link their own DJI Cloud platform web account so uploads and
 * other actions they take are attributed to them on the platform, instead
 * of every SkyRoute user sharing the one server-wide service account
 * (DJI_CLOUD_USERNAME). Only rendered when this deployment has the DJI
 * Cloud bridge configured at all — linking a personal account on top of an
 * unconfigured bridge would have nothing to verify against. */
export function DjiCloudAccountLink() {
  const djiCloudEnabled = useConfigStore((s) => s.djiCloudEnabled);
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!djiCloudEnabled) return;
    api
      .get<LinkStatus>("/dji-cloud/account/link")
      .then(setStatus)
      .catch(() => setStatus({ linked: false }))
      .finally(() => setLoading(false));
  }, [djiCloudEnabled]);

  if (!djiCloudEnabled) return null;

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinking(true);
    setError(null);
    try {
      await api.post("/dji-cloud/account/link", { username, password });
      setStatus({ linked: true, username, linkedAt: new Date().toISOString() });
      setUsername("");
      setPassword("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async () => {
    setLinking(true);
    setError(null);
    try {
      await api.delete("/dji-cloud/account/link");
      setStatus({ linked: false });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="pt-4 border-t border-border space-y-2">
      <Label className="text-xs">DJI Cloud účet</Label>
      {loading ? (
        <p className="text-[11px] text-muted-foreground">Načítám...</p>
      ) : status?.linked ? (
        <>
          <p className="text-[11px] text-muted-foreground">
            Propojeno jako{" "}
            <span className="text-foreground">{status.username}</span>
            {status.linkedAt && ` (od ${formatLinkedAt(status.linkedAt)})`}.
            Nahrávání a další akce v DJI Cloud se nyní provádí pod tímto účtem
            místo sdíleného servisního účtu.
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            type="button"
            variant="outline"
            className="w-full h-9 text-sm"
            disabled={linking}
            onClick={handleUnlink}
          >
            Odpojit
          </Button>
        </>
      ) : (
        <form onSubmit={handleLink} className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Propojte svůj vlastní účet na DJI Cloud platformě, aby nahrávání a
            další akce byly na platformě evidované pod vaším jménem, ne pod
            jedním sdíleným servisním účtem.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="djiCloudUsername" className="text-xs">
              Uživatelské jméno na DJI Cloud
            </Label>
            <Input
              id="djiCloudUsername"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-9 text-sm"
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="djiCloudPassword" className="text-xs">
              Heslo
            </Label>
            <Input
              id="djiCloudPassword"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 text-sm"
              required
              autoComplete="off"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            type="submit"
            className="w-full h-9 text-sm"
            disabled={linking}
          >
            {linking ? "Ověřuji..." : "Propojit účet"}
          </Button>
        </form>
      )}
    </div>
  );
}
