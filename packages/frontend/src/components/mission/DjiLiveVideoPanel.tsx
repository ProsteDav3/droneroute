import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { ChevronDown, ChevronRight, Video, VideoOff } from "lucide-react";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";

/** Plays an HLS stream in a plain <video> element — native HLS support in
 * Safari, hls.js everywhere else. Re-attaches whenever `src` changes
 * (starting a different camera/lens). hls.js (~500KB) is dynamically
 * imported here rather than at the top of the module — nobody outside
 * this one panel needs it, so it shouldn't cost every visitor a slice of
 * the main bundle just for DJI Cloud users who never open live video. */
function HlsPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }

    let hls: Hls | null = null;
    let cancelled = false;
    void import("hls.js").then(({ default: HlsCtor }) => {
      if (cancelled || !HlsCtor.isSupported()) return;
      hls = new HlsCtor();
      hls.loadSource(src);
      hls.attachMedia(video);
    });
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      controls
      className="w-full rounded border border-border bg-black aspect-video"
    />
  );
}

/** Live video from an aircraft/RC camera, pushed as RTMP to this server's
 * own relay and watched back as HLS — see djiCloud.ts's `buildHlsUrl` for
 * why a self-hosted deployment without that relay add-on can start a feed
 * but won't have a URL to play here. Only ever shows cameras the platform
 * itself reports as currently live-capable (i.e. currently online), so an
 * empty list here just means nothing is connected right now. */
export function DjiLiveVideoPanel() {
  const {
    liveCapacity,
    liveCapacityLoading,
    liveCapacityError,
    fetchLiveCapacity,
    activeLiveVideoId,
    activeLiveHlsUrl,
    liveStarting,
    liveError,
    startLive,
    stopLive,
  } = useDjiCloudOpsStore();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded && liveCapacity.length === 0 && !liveCapacityLoading) {
      void fetchLiveCapacity();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const cameras = liveCapacity.flatMap((device) =>
    device.cameras_list.flatMap((camera) => {
      // The platform doesn't always populate a camera name (e.g. an M4T's
      // single payload reports none at all) — fall back to the video's own
      // lens type ("wide"/"normal"/...) rather than showing "undefined".
      const cameraLabel =
        camera.name && camera.name !== "undefined" ? camera.name : null;
      return camera.videos_list.map((video) => ({
        videoId: video.id,
        label: cameraLabel
          ? `${device.name} — ${cameraLabel}${
              camera.videos_list.length > 1 ? ` (${video.type})` : ""
            }`
          : `${device.name} — ${video.type}`,
      }));
    }),
  );

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
        Živý přenos
      </button>
      {expanded && (
        <div className="space-y-1.5 pl-1">
          {liveCapacityLoading && (
            <p className="text-[10px] text-muted-foreground">Načítám...</p>
          )}
          {liveCapacityError && (
            <p className="text-[10px] text-red-400">{liveCapacityError}</p>
          )}
          {!liveCapacityLoading &&
            !liveCapacityError &&
            cameras.length === 0 && (
              <p className="text-[10px] text-muted-foreground">
                Žádná kamera momentálně nevysílá — zařízení musí být online.
              </p>
            )}

          {!activeLiveVideoId &&
            cameras.map((cam) => (
              <button
                key={cam.videoId}
                type="button"
                onClick={() => void startLive(cam.videoId)}
                disabled={liveStarting}
                className="flex items-center gap-1.5 w-full text-left text-[11px] rounded px-1 py-0.5 -mx-1 hover:bg-muted disabled:opacity-50"
              >
                <Video className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate">{cam.label}</span>
              </button>
            ))}

          {activeLiveVideoId && (
            <div className="space-y-1.5">
              {activeLiveHlsUrl ? (
                <HlsPlayer src={activeLiveHlsUrl} />
              ) : (
                <p className="text-[10px] text-amber-400">
                  Přenos spuštěn, ale server nemá nastavený
                  DJI_CLOUD_LIVE_HLS_BASE_URL pro přehrávání zde.
                </p>
              )}
              <button
                type="button"
                onClick={() => void stopLive()}
                className="flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-300"
              >
                <VideoOff className="h-3 w-3" />
                Zastavit přenos
              </button>
            </div>
          )}

          {liveError && <p className="text-[10px] text-red-400">{liveError}</p>}
        </div>
      )}
    </div>
  );
}
