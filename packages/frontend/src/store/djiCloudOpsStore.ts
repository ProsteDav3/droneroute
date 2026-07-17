import { create } from "zustand";
import { api } from "@/lib/api";

export interface DjiDeviceSummary {
  device_sn: string;
  nickname: string;
  device_name: string;
  device_model_key?: string;
  bound_status: boolean;
  login_time?: string;
  status?: boolean;
}

export interface DjiHmsMessage {
  sn: string;
  key: string;
  level: number;
  module: number;
  create_time: string;
  message_zh: string;
  message_en: string;
}

export interface DeviceTelemetry {
  deviceSn: string;
  online: boolean;
  latitude?: number;
  longitude?: number;
  height?: number;
  horizontalSpeed?: number;
  attitudeHead?: number;
  batteryPercent?: number;
  updatedAt: number;
}

export interface DjiWaylineSummary {
  id: string;
  name: string;
  user_name?: string;
  create_time?: number;
  update_time?: number;
}

export interface DjiMediaFile {
  file_id: string;
  file_name: string;
  create_time: number;
}

export interface DjiLiveVideo {
  id: string;
  index: string;
  type: string;
}

export interface DjiLiveCapableCamera {
  id: string;
  device_sn: string;
  name: string;
  index: string;
  type: string;
  videos_list: DjiLiveVideo[];
}

export interface DjiLiveCapacityDevice {
  sn: string;
  name: string;
  cameras_list: DjiLiveCapableCamera[];
}

interface DjiCloudOpsState {
  devices: DjiDeviceSummary[];
  hmsMessages: DjiHmsMessage[];
  telemetry: Record<string, DeviceTelemetry>;
  waylines: DjiWaylineSummary[];
  waylinesLoading: boolean;
  waylinesError: string | null;
  deletingWaylineId: string | null;
  loading: boolean;
  error: string | null;
  /** Which bound device's telemetry to focus on (Mission Progress panel,
   * map highlight) when more than one is bound/online — `null` means "first
   * online device", matching the app's original single-device behavior. */
  focusedDeviceSn: string | null;
  setFocusedDeviceSn: (sn: string | null) => void;
  media: DjiMediaFile[];
  mediaTotal: number;
  mediaLoading: boolean;
  mediaError: string | null;
  fetchMedia: () => Promise<void>;
  getMediaDownloadUrl: (fileId: string) => Promise<string>;
  liveCapacity: DjiLiveCapacityDevice[];
  liveCapacityLoading: boolean;
  liveCapacityError: string | null;
  fetchLiveCapacity: () => Promise<void>;
  activeLiveVideoId: string | null;
  activeLiveHlsUrl: string | null;
  liveStarting: boolean;
  liveError: string | null;
  startLive: (videoId: string) => Promise<void>;
  stopLive: () => Promise<void>;
  fetchDevicesAndHms: () => Promise<void>;
  fetchWaylines: () => Promise<void>;
  deleteWaylineFromLibrary: (id: string) => Promise<void>;
  startTelemetryStream: () => () => void;
}

/** Live operational state fetched from the DJI Cloud bridge — device fleet,
 * HMS warnings, and (via SSE) real-time aircraft telemetry. Deliberately
 * separate from missionStore: this is fleet/operations state, not mission
 * content, and shouldn't participate in undo/redo or autosave. */
export const useDjiCloudOpsStore = create<DjiCloudOpsState>((set, get) => ({
  devices: [],
  hmsMessages: [],
  telemetry: {},
  waylines: [],
  waylinesLoading: false,
  waylinesError: null,
  deletingWaylineId: null,
  loading: false,
  error: null,

  focusedDeviceSn: null,
  setFocusedDeviceSn: (sn) => set({ focusedDeviceSn: sn }),

  media: [],
  mediaTotal: 0,
  mediaLoading: false,
  mediaError: null,

  fetchMedia: async () => {
    set({ mediaLoading: true, mediaError: null });
    try {
      const res = await api.get<{ list: DjiMediaFile[]; total: number }>(
        "/dji-cloud/media?page=1&pageSize=20",
      );
      set({ media: res.list, mediaTotal: res.total, mediaLoading: false });
    } catch (err: any) {
      set({ mediaError: err.message, mediaLoading: false });
    }
  },

  getMediaDownloadUrl: async (fileId: string) => {
    const res = await api.get<{ url: string }>(
      `/dji-cloud/media/${encodeURIComponent(fileId)}/url`,
    );
    return res.url;
  },

  liveCapacity: [],
  liveCapacityLoading: false,
  liveCapacityError: null,

  fetchLiveCapacity: async () => {
    set({ liveCapacityLoading: true, liveCapacityError: null });
    try {
      const res = await api.get<{ devices: DjiLiveCapacityDevice[] }>(
        "/dji-cloud/live/capacity",
      );
      set({ liveCapacity: res.devices, liveCapacityLoading: false });
    } catch (err: any) {
      set({ liveCapacityError: err.message, liveCapacityLoading: false });
    }
  },

  activeLiveVideoId: null,
  activeLiveHlsUrl: null,
  liveStarting: false,
  liveError: null,

  startLive: async (videoId: string) => {
    set({ liveStarting: true, liveError: null });
    try {
      const res = await api.post<{ hlsUrl: string | null }>(
        "/dji-cloud/live/start",
        { videoId },
      );
      set({
        activeLiveVideoId: videoId,
        activeLiveHlsUrl: res.hlsUrl,
        liveStarting: false,
      });
    } catch (err: any) {
      set({ liveError: err.message, liveStarting: false });
    }
  },

  stopLive: async () => {
    const videoId = get().activeLiveVideoId;
    if (!videoId) return;
    try {
      await api.post("/dji-cloud/live/stop", { videoId });
    } catch (err: any) {
      set({ liveError: err.message });
    } finally {
      set({ activeLiveVideoId: null, activeLiveHlsUrl: null });
    }
  },

  fetchDevicesAndHms: async () => {
    set({ loading: true, error: null });
    // Settled independently, not Promise.all: the platform's HMS endpoint
    // (at least DJI's own reference implementation) errors out when no
    // device has ever reported a warning yet, which is the common case for
    // a freshly bound workspace — that shouldn't take the device list down
    // with it. A devices-fetch failure is still the one that surfaces as
    // this panel's blocking error; a HMS-only failure just means an empty
    // warnings list.
    const [devicesResult, hmsResult] = await Promise.allSettled([
      api.get<{ devices: DjiDeviceSummary[] }>("/dji-cloud/devices"),
      api.get<{ messages: DjiHmsMessage[] }>("/dji-cloud/hms"),
    ]);
    set({
      devices:
        devicesResult.status === "fulfilled" ? devicesResult.value.devices : [],
      hmsMessages:
        hmsResult.status === "fulfilled" ? hmsResult.value.messages : [],
      error:
        devicesResult.status === "rejected"
          ? (devicesResult.reason as Error).message
          : null,
      loading: false,
    });
  },

  fetchWaylines: async () => {
    set({ waylinesLoading: true, waylinesError: null });
    try {
      const res = await api.get<{ waylines: DjiWaylineSummary[] }>(
        "/dji-cloud/waylines",
      );
      set({ waylines: res.waylines, waylinesLoading: false });
    } catch (err: any) {
      set({ waylinesError: err.message, waylinesLoading: false });
    }
  },

  /** Optimistically removes the wayline from local state on success, rather
   * than re-fetching the whole library — one file's worth of state doesn't
   * need a round trip to stay in sync. */
  deleteWaylineFromLibrary: async (id: string) => {
    set({ deletingWaylineId: id });
    try {
      await api.delete(`/dji-cloud/waylines/${encodeURIComponent(id)}`);
      set((state) => ({
        waylines: state.waylines.filter((w) => w.id !== id),
        deletingWaylineId: null,
      }));
    } catch (err: any) {
      set({ waylinesError: err.message, deletingWaylineId: null });
    }
  },

  /** Opens an SSE connection to /dji-cloud/telemetry/stream. Returns a
   * cleanup function that closes it — call from a useEffect's return.
   *
   * Uses `fetch` + a manual stream reader rather than the native
   * `EventSource` API: EventSource can't set request headers, and although
   * auth here is now the same httpOnly session cookie every other request
   * uses (sent automatically), `fetch`'s manual stream reading is kept
   * anyway since it's what the rest of this store's error handling already
   * assumes. */
  startTelemetryStream: () => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/dji-cloud/telemetry/stream", {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const chunk of events) {
            const line = chunk.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            try {
              const record = JSON.parse(
                line.slice(5).trim(),
              ) as DeviceTelemetry;
              set({
                telemetry: { ...get().telemetry, [record.deviceSn]: record },
              });
            } catch {
              // malformed event — ignore rather than crash the stream reader
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          // Network drop or server restart — the caller's useEffect can
          // re-invoke startTelemetryStream on remount; no auto-retry here
          // to keep this store simple.
        }
      }
    })();

    return () => controller.abort();
  },
}));
