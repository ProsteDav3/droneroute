import { create } from "zustand";
import { api } from "@/lib/api";
import { useMissionStore } from "./missionStore";

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
  logout: () => void;
  restore: () => void;
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

      localStorage.setItem("droneroute_token", res.token!);
      localStorage.setItem("droneroute_email", res.email!);
      localStorage.setItem("droneroute_is_admin", String(res.isAdmin));
      set({
        token: res.token!,
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
      localStorage.setItem("droneroute_token", res.token);
      localStorage.setItem("droneroute_email", res.email);
      localStorage.setItem("droneroute_is_admin", String(res.isAdmin));
      set({
        token: res.token,
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
      localStorage.setItem("droneroute_token", res.token);
      localStorage.setItem("droneroute_email", res.email);
      localStorage.setItem("droneroute_is_admin", String(res.isAdmin));
      set({
        token: res.token,
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
      localStorage.setItem("droneroute_token", res.token);
      localStorage.setItem("droneroute_email", res.email);
      localStorage.setItem("droneroute_is_admin", String(res.isAdmin));
      set({
        token: res.token,
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

  logout: () => {
    localStorage.removeItem("droneroute_token");
    localStorage.removeItem("droneroute_email");
    localStorage.removeItem("droneroute_is_admin");
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

  restore: () => {
    const token = localStorage.getItem("droneroute_token");
    const email = localStorage.getItem("droneroute_email");
    const isAdmin = localStorage.getItem("droneroute_is_admin") === "true";
    if (token && email) {
      set({ token, email, isAdmin, hasRestored: true });
    } else {
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
