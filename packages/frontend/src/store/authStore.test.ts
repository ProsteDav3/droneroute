import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// The frontend test environment is plain Node (no jsdom), which has no
// localStorage global — stub a minimal in-memory implementation since
// authStore reads/writes it directly.
function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

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
  vi.stubGlobal("localStorage", createMemoryStorage());
}

describe("authStore.restore", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores the token from localStorage and marks hasRestored", () => {
    localStorage.setItem("droneroute_token", "tok123");
    localStorage.setItem("droneroute_email", "user@test.dev");
    localStorage.setItem("droneroute_is_admin", "true");

    useAuthStore.getState().restore();

    const state = useAuthStore.getState();
    expect(state.token).toBe("tok123");
    expect(state.email).toBe("user@test.dev");
    expect(state.isAdmin).toBe(true);
    expect(state.hasRestored).toBe(true);
  });

  it("marks hasRestored even when no stored session exists", () => {
    useAuthStore.getState().restore();

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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores the token and admin flag on successful bootstrap registration", async () => {
    mockedApi.post.mockResolvedValue({
      token: "tok456",
      userId: "u1",
      email: "founder@test.dev",
      isAdmin: true,
    });

    await useAuthStore.getState().register("founder@test.dev", "secret123");

    const state = useAuthStore.getState();
    expect(state.token).toBe("tok456");
    expect(state.isAdmin).toBe(true);
    expect(localStorage.getItem("droneroute_token")).toBe("tok456");
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

  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(useAuthStore.getState().token).toBe("tok789");
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
    expect(state.token).toBe("tok999");
    expect(state.twoFactorChallenge).toBeNull();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/2fa/login", {
      challengeToken: "challenge-abc",
      code: "123456",
    });
  });
});
