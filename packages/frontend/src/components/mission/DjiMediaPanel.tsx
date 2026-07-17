import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Image, RefreshCw } from "lucide-react";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";

function formatMediaTime(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleString("cs-CZ", {
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Opens the file's real (presigned) download URL in a new tab — resolved
 * lazily on click rather than upfront for every row, since the platform's
 * URL-resolution endpoint does a full login round-trip per call. */
function DownloadLink({
  fileId,
  fileName,
}: {
  fileId: string;
  fileName: string;
}) {
  const getMediaDownloadUrl = useDjiCloudOpsStore((s) => s.getMediaDownloadUrl);
  const [resolving, setResolving] = useState(false);

  const handleClick = async () => {
    setResolving(true);
    try {
      const url = await getMediaDownloadUrl(fileId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // Resolution failure isn't worth its own error banner here — the
      // media list itself still rendered fine, only this one link failed.
    } finally {
      setResolving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={resolving}
      className="text-[10px] text-[#33cfff] hover:underline disabled:opacity-50 shrink-0"
      title={fileName}
    >
      {resolving ? "..." : "Stáhnout"}
    </button>
  );
}

/** Photos/videos the aircraft or RC has already uploaded into the
 * workspace's own storage after a flight — surfaced here so a pilot
 * doesn't have to separately open the DJI Cloud platform's own console.
 * SkyRoute never stores or proxies the files themselves, only lists what's
 * there and links to the platform's own presigned download URLs. */
export function DjiMediaPanel() {
  const { media, mediaTotal, mediaLoading, mediaError, fetchMedia } =
    useDjiCloudOpsStore();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded && media.length === 0 && !mediaLoading) {
      void fetchMedia();
    }
    // Only auto-fetch the first time the section is opened — the refresh
    // button below covers "check again" without re-fetching on every
    // unrelated store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  return (
    <div className="pt-1 border-t border-border/50">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-300 transition-colors py-1"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Média{mediaTotal > 0 ? ` (${mediaTotal})` : ""}
      </button>
      {expanded && (
        <div className="space-y-1.5 pl-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              Fotky a videa nahraná z poslední mise
            </p>
            <button
              type="button"
              onClick={() => void fetchMedia()}
              disabled={mediaLoading}
              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Obnovit"
            >
              <RefreshCw
                className={`h-3 w-3 ${mediaLoading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          {mediaLoading && media.length === 0 && (
            <p className="text-[10px] text-muted-foreground">Načítám...</p>
          )}
          {mediaError && (
            <p className="text-[10px] text-red-400">{mediaError}</p>
          )}
          {!mediaLoading && !mediaError && media.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              Zatím žádná média
            </p>
          )}
          {media.map((file) => (
            <div
              key={file.file_id}
              className="flex items-center gap-2 text-[11px]"
            >
              <Image className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="truncate flex-1" title={file.file_name}>
                {file.file_name}
              </span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatMediaTime(file.create_time)}
              </span>
              <DownloadLink fileId={file.file_id} fileName={file.file_name} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
