import { create } from "zustand";
import { api } from "@/lib/api";
import { useMissionStore } from "./missionStore";

/**
 * The session itself now lives in an httpOnly cookie the backend sets on
 * login/register/etc (see packages/backend/src/lib/authCookie.ts) — the
 * frontend never holds the real JWT in JS-readable state anymore, since
 * that would defeat the point of `httpOnly` (any XSS could just read it
 * from here instead of `document.cookie`). `token` stays in this shape as a
 * plain "is there a session" marker so the handful of existing truthy
 * checks (`if (token)`, `disabled={!token}`) elsewhere keep working
 * unchanged — its value is never the actual token.
 */
const SESSION_MARKER = "session";

interface AuthState {
  token: string | null;
  email: string | null;
  userId: string | null;
  isAdmin: boolean;
  isLoading: boolean;
  needsVerification: boolean;
  hasRestored: boolean;
  /** Set by `login` when the account has 2FA enabled; consumed by `loginWithTwoFactorCode`. */
  twoFactorChallenge: string | null;

  login: (
    email: string,
    password: string,
  ) => Promise<{ requiresTwoFactor: boolean }>;
  loginWithTwoFactorCode: (code: string) => Promise<void>;
  cancelTwoFactorChallenge: () => void;
  register: (
    email: string,
    password: string,
    bootstrapToken?: string,
  ) => Promise<void>;
  googleLogin: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Asks the backend (via the httpOnly cookie) whether a session already
   * exists — replaces the old synchronous localStorage read, since the
   * cookie's value isn't readable from JS to check locally. */
  restore: () => Promise<void>;
  setNeedsVerification: (value: boolean) => void;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  email: null,
  userId: null,
  isAdmin: false,
  isLoading: false,
  needsVerification: false,
  hasRestored: false,
  twoFactorChallenge: null,

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const res = await api.post<{
        token?: string;
        userId?: string;
        email?: string;
        isAdmin?: boolean;
        requiresTwoFactor?: boolean;
        challengeToken?: string;
      }>("/auth/login", { email, password });

      if (res.requiresTwoFactor) {
        set({
          isLoading: false,
          twoFactorChallenge: res.challengeToken ?? null,
        });
        return { requiresTwoFactor: true };
      }

      set({
        token: SESSION_MARKER,
        email: res.email!,
        userId: res.userId!,
        isAdmin: !!res.isAdmin,
        isLoading: false,
        needsVerification: false,
        twoFactorChallenge: null,
      });
      return { requiresTwoFactor: false };
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  loginWithTwoFactorCode: async (code: string) => {
    const challengeToken = get().twoFactorChallenge;
    if (!challengeToken) {
      throw new Error("Chybí platná výzva pro dvoufázové ověření");
    }
    set({ isLoading: true });
    try {
      const res = await api.post<{
        token: string;
        userId: string;
        email: string;
        isAdmin: boolean;
      }>("/auth/2fa/login", { challengeToken, code });
      set({
        token: SESSION_MARKER,
        email: res.email,
        userId: res.userId,
        isAdmin: res.isAdmin,
        isLoading: false,
        needsVerification: false,
        twoFactorChallenge: null,
      });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  cancelTwoFactorChallenge: () => set({ twoFactorChallenge: null }),

  register: async (email, password, bootstrapToken) => {
    set({ isLoading: true });
    try {
      const res = await api.post<{
        token: string;
        userId: string;
        email: string;
        isAdmin: boolean;
      }>("/auth/register", { email, password, bootstrapToken });
      set({
        token: SESSION_MARKER,
        email: res.email,
        userId: res.userId,
        isAdmin: res.isAdmin,
        isLoading: false,
        needsVerification: false,
      });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  googleLogin: async (credential: string) => {
    set({ isLoading: true });
    try {
      const res = await api.post<{
        token: string;
        userId: string;
        email: string;
        isAdmin: boolean;
      }>("/auth/google", { credential });
      set({
        token: SESSION_MARKER,
        email: res.email,
        userId: res.userId,
        isAdmin: res.isAdmin,
        isLoading: false,
        needsVerification: false,
      });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    // The cookie is httpOnly — this tab's JS can't clear it itself, so
    // logout now needs a real request. Clear local state regardless of
    // whether the request succeeds (e.g. the network is down): staying
    // "logged in" client-side when the user asked to log out would be
    // worse than a cookie that lingers until it expires.
    try {
      await api.post("/auth/logout");
    } catch {
      // best-effort — see comment above
    }
    set({
      token: null,
      email: null,
      userId: null,
      isAdmin: false,
      needsVerification: false,
      twoFactorChallenge: null,
    });
    useMissionStore.getState().clearMission();
  },

  restore: async () => {
    try {
      const res = await api.get<{
        userId: string;
        email: string;
        isAdmin: boolean;
      }>("/auth/me");
      set({
        token: SESSION_MARKER,
        email: res.email,
        userId: res.userId,
        isAdmin: res.isAdmin,
        hasRestored: true,
      });
    } catch {
      // No valid session cookie (never logged in, expired, or logged out
      // elsewhere) — same end state as before this migration's "no token in
      // localStorage" case.
      set({ hasRestored: true });
    }
  },

  setNeedsVerification: (value: boolean) => {
    set({ needsVerification: value });
  },

  forgotPassword: async (email: string) => {
    await api.post<{ message: string }>("/auth/forgot-password", { email });
  },

  resetPassword: async (token: string, newPassword: string) => {
    await api.post<{ message: string }>("/auth/reset-password", {
      token,
      newPassword,
    });
  },
}));
