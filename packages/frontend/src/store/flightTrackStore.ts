import { create } from "zustand";
import { api } from "@/lib/api";

export interface FlightTrackSession {
  id: string;
  missionId: string | null;
  userId: string;
  deviceSn: string;
  startedAt: string;
  endedAt: string | null;
}

export interface FlightTrackPoint {
  recordedAt: number;
  latitude: number;
  longitude: number;
  height: number | null;
  horizontalSpeed: number | null;
  batteryPercent: number | null;
}

interface FlightTrackState {
  recordingDeviceSn: string | null;
  recordingSessionId: string | null;
  recordingStarting: boolean;
  recordingError: string | null;
  startRecording: (deviceSn: string, missionId: string | null) => Promise<void>;
  stopRecording: () => Promise<void>;

  sessions: FlightTrackSession[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  fetchSessions: (missionId: string) => Promise<void>;
  deleteSession: (sessionId: string, missionId: string) => Promise<void>;

  selectedSessionId: string | null;
  trackPoints: FlightTrackPoint[];
  trackPointsLoading: boolean;
  trackPointsError: string | null;
  loadSessionPoints: (sessionId: string) => Promise<void>;
  clearSelectedSession: () => void;
}

/** Flight-track recording — this fleet has no DJI Dock, so there is no
 * platform-side flight history to import after the fact; recording live OSD
 * telemetry while the pilot flies (server-side, see djiCloud.ts's
 * flight-track routes) is the only way to later compare planned vs. actually
 * flown. Deliberately a separate store from djiCloudOpsStore — that one is
 * live fleet/telemetry state, this is mission-scoped recorded history. */
export const useFlightTrackStore = create<FlightTrackState>((set, get) => ({
  recordingDeviceSn: null,
  recordingSessionId: null,
  recordingStarting: false,
  recordingError: null,

  startRecording: async (deviceSn, missionId) => {
    set({ recordingStarting: true, recordingError: null });
    try {
      const res = await api.post<{ session: FlightTrackSession }>(
        "/dji-cloud/flight-track/start",
        { deviceSn, missionId },
      );
      set({
        recordingDeviceSn: deviceSn,
        recordingSessionId: res.session.id,
        recordingStarting: false,
      });
    } catch (err: any) {
      set({ recordingError: err.message, recordingStarting: false });
    }
  },

  stopRecording: async () => {
    const deviceSn = get().recordingDeviceSn;
    if (!deviceSn) return;
    try {
      await api.post("/dji-cloud/flight-track/stop", { deviceSn });
    } catch (err: any) {
      set({ recordingError: err.message });
    } finally {
      set({ recordingDeviceSn: null, recordingSessionId: null });
    }
  },

  sessions: [],
  sessionsLoading: false,
  sessionsError: null,

  fetchSessions: async (missionId) => {
    set({ sessionsLoading: true, sessionsError: null });
    try {
      const res = await api.get<{ sessions: FlightTrackSession[] }>(
        `/dji-cloud/flight-track/sessions?missionId=${encodeURIComponent(missionId)}`,
      );
      set({ sessions: res.sessions, sessionsLoading: false });
    } catch (err: any) {
      set({ sessionsError: err.message, sessionsLoading: false });
    }
  },

  deleteSession: async (sessionId, missionId) => {
    try {
      await api.delete(
        `/dji-cloud/flight-track/sessions/${encodeURIComponent(sessionId)}`,
      );
      if (get().selectedSessionId === sessionId) {
        get().clearSelectedSession();
      }
      await get().fetchSessions(missionId);
    } catch (err: any) {
      set({ sessionsError: err.message });
    }
  },

  selectedSessionId: null,
  trackPoints: [],
  trackPointsLoading: false,
  trackPointsError: null,

  loadSessionPoints: async (sessionId) => {
    set({
      trackPointsLoading: true,
      trackPointsError: null,
      selectedSessionId: sessionId,
    });
    try {
      const res = await api.get<{ points: FlightTrackPoint[] }>(
        `/dji-cloud/flight-track/sessions/${encodeURIComponent(sessionId)}/points`,
      );
      set({ trackPoints: res.points, trackPointsLoading: false });
    } catch (err: any) {
      set({ trackPointsError: err.message, trackPointsLoading: false });
    }
  },

  clearSelectedSession: () => {
    set({ selectedSessionId: null, trackPoints: [] });
  },
}));
