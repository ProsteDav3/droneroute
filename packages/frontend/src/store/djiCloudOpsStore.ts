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
  device_sn: string;
  key: string;
  level: number;
  module: number;
  create_time: number;
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

  fetchDevicesAndHms: async () => {
    set({ loading: true, error: null });
    try {
      const [devicesRes, hmsRes] = await Promise.all([
        api.get<{ devices: DjiDeviceSummary[] }>("/dji-cloud/devices"),
        api.get<{ messages: DjiHmsMessage[] }>("/dji-cloud/hms"),
      ]);
      set({
        devices: devicesRes.devices,
        hmsMessages: hmsRes.messages,
        loading: false,
      });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
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
   * `EventSource` API: EventSource can't set an Authorization header, and
   * this endpoint requires one — putting the JWT in the URL instead would
   * leak it into server access logs and browser history, so it isn't an
   * acceptable alternative. */
  startTelemetryStream: () => {
    const token = localStorage.getItem("droneroute_token");
    if (!token) return () => {};

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/dji-cloud/telemetry/stream", {
          headers: { Authorization: `Bearer ${token}` },
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
