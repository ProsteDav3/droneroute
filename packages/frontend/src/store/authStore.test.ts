import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuthStore } from "./authStore";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

function resetStore() {
  useAuthStore.setState({
    token: null,
    email: null,
    userId: null,
    isAdmin: false,
    isLoading: false,
    needsVerification: false,
    hasRestored: false,
    twoFactorChallenge: null,
  });
}

describe("authStore.restore", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("restores the session via GET /auth/me and marks hasRestored", async () => {
    mockedApi.get.mockResolvedValue({
      userId: "u1",
      email: "user@test.dev",
      isAdmin: true,
    });

    await useAuthStore.getState().restore();

    const state = useAuthStore.getState();
    expect(state.token).not.toBeNull();
    expect(state.userId).toBe("u1");
    expect(state.email).toBe("user@test.dev");
    expect(state.isAdmin).toBe(true);
    expect(state.hasRestored).toBe(true);
    expect(mockedApi.get).toHaveBeenCalledWith("/auth/me");
  });

  it("marks hasRestored (logged out) when there's no valid session cookie", async () => {
    mockedApi.get.mockRejectedValue(new Error("401"));

    await useAuthStore.getState().restore();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.hasRestored).toBe(true);
  });
});

describe("authStore.register", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("marks the session authenticated on successful bootstrap registration, without exposing the raw token", async () => {
    mockedApi.post.mockResolvedValue({
      token: "tok456",
      userId: "u1",
      email: "founder@test.dev",
      isAdmin: true,
    });

    await useAuthStore.getState().register("founder@test.dev", "secret123");

    const state = useAuthStore.getState();
    // The real JWT now lives only in the httpOnly cookie the backend set —
    // the store must never hold the raw token value in JS-readable state
    // (that would defeat httpOnly's XSS protection).
    expect(state.token).not.toBe("tok456");
    expect(state.token).not.toBeNull();
    expect(state.isAdmin).toBe(true);
  });

  it("resets isLoading and rethrows when registration is closed", async () => {
    mockedApi.post.mockRejectedValue(new Error("Registration is closed"));

    await expect(
      useAuthStore.getState().register("second@test.dev", "secret123"),
    ).rejects.toThrow("Registration is closed");

    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});

describe("authStore.login — 2FA challenge", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("stores the challenge token and reports requiresTwoFactor instead of signing in", async () => {
    mockedApi.post.mockResolvedValue({
      requiresTwoFactor: true,
      challengeToken: "challenge-abc",
    });

    const result = await useAuthStore
      .getState()
      .login("twofa@test.dev", "secret123");

    expect(result).toEqual({ requiresTwoFactor: true });
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().twoFactorChallenge).toBe("challenge-abc");
  });

  it("signs in normally when the account has no 2FA enabled", async () => {
    mockedApi.post.mockResolvedValue({
      token: "tok789",
      userId: "u1",
      email: "user@test.dev",
      isAdmin: false,
    });

    const result = await useAuthStore
      .getState()
      .login("user@test.dev", "secret123");

    expect(result).toEqual({ requiresTwoFactor: false });
    expect(useAuthStore.getState().token).not.toBeNull();
    expect(useAuthStore.getState().userId).toBe("u1");
  });

  it("loginWithTwoFactorCode throws when no challenge is pending", async () => {
    await expect(
      useAuthStore.getState().loginWithTwoFactorCode("123456"),
    ).rejects.toThrow();
  });

  it("loginWithTwoFactorCode completes sign-in and clears the challenge", async () => {
    useAuthStore.setState({ twoFactorChallenge: "challenge-abc" });
    mockedApi.post.mockResolvedValue({
      token: "tok999",
      userId: "u1",
      email: "twofa@test.dev",
      isAdmin: false,
    });

    await useAuthStore.getState().loginWithTwoFactorCode("123456");

    const state = useAuthStore.getState();
    expect(state.token).not.toBeNull();
    expect(state.twoFactorChallenge).toBeNull();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/2fa/login", {
      challengeToken: "challenge-abc",
      code: "123456",
    });
  });
});

describe("authStore.logout", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("calls POST /auth/logout to clear the httpOnly cookie and resets local state", async () => {
    useAuthStore.setState({
      token: "session",
      userId: "u1",
      email: "user@test.dev",
      isAdmin: true,
    });
    mockedApi.post.mockResolvedValue({ message: "Odhlášeno" });

    await useAuthStore.getState().logout();

    expect(mockedApi.post).toHaveBeenCalledWith("/auth/logout");
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.userId).toBeNull();
    expect(state.email).toBeNull();
    expect(state.isAdmin).toBe(false);
  });

  it("still clears local state even when the logout request fails", async () => {
    useAuthStore.setState({ token: "session", isAdmin: true });
    mockedApi.post.mockRejectedValue(new Error("network down"));

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().token).toBeNull();
  });
});
