import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTemplatePresetsStore } from "./templatePresetsStore";
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
  useTemplatePresetsStore.setState({ presets: [], isLoading: false });
}

describe("templatePresetsStore", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("fetchPresets loads presets from the API", async () => {
    const presets = [
      {
        id: "1",
        name: "KCP orbit",
        type: "orbit",
        params: { radiusM: 80 },
        createdAt: "2026-01-01",
      },
    ];
    mockedApi.get.mockResolvedValue(presets);

    await useTemplatePresetsStore.getState().fetchPresets();

    expect(mockedApi.get).toHaveBeenCalledWith("/template-presets");
    expect(useTemplatePresetsStore.getState().presets).toEqual(presets);
    expect(useTemplatePresetsStore.getState().isLoading).toBe(false);
  });

  it("fetchPresets leaves presets empty and logs on failure, without throwing", async () => {
    mockedApi.get.mockRejectedValue(new Error("network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      useTemplatePresetsStore.getState().fetchPresets(),
    ).resolves.toBeUndefined();

    expect(useTemplatePresetsStore.getState().presets).toEqual([]);
    expect(useTemplatePresetsStore.getState().isLoading).toBe(false);
    consoleSpy.mockRestore();
  });

  it("createPreset prepends the newly created preset", async () => {
    const created = {
      id: "new-id",
      name: "New preset",
      type: "orbit",
      params: { radiusM: 50 },
      createdAt: "2026-01-02",
    };
    mockedApi.post.mockResolvedValue(created);
    useTemplatePresetsStore.setState({
      presets: [
        {
          id: "existing",
          name: "Existing",
          type: "grid",
          params: {},
          createdAt: "2026-01-01",
        },
      ],
    });

    await useTemplatePresetsStore
      .getState()
      .createPreset("New preset", "orbit", { radiusM: 50 });

    expect(mockedApi.post).toHaveBeenCalledWith("/template-presets", {
      name: "New preset",
      type: "orbit",
      params: { radiusM: 50 },
    });
    const { presets } = useTemplatePresetsStore.getState();
    expect(presets).toHaveLength(2);
    expect(presets[0]).toEqual(created);
  });

  it("renamePreset updates only the matching preset's name locally", async () => {
    mockedApi.put.mockResolvedValue({ id: "1" });
    useTemplatePresetsStore.setState({
      presets: [
        {
          id: "1",
          name: "Old name",
          type: "orbit",
          params: {},
          createdAt: "2026-01-01",
        },
        {
          id: "2",
          name: "Untouched",
          type: "grid",
          params: {},
          createdAt: "2026-01-01",
        },
      ],
    });

    await useTemplatePresetsStore.getState().renamePreset("1", "New name");

    expect(mockedApi.put).toHaveBeenCalledWith("/template-presets/1", {
      name: "New name",
    });
    const { presets } = useTemplatePresetsStore.getState();
    expect(presets.find((p) => p.id === "1")!.name).toBe("New name");
    expect(presets.find((p) => p.id === "2")!.name).toBe("Untouched");
  });

  it("removePreset deletes only the matching preset locally", async () => {
    mockedApi.delete.mockResolvedValue({ success: true });
    useTemplatePresetsStore.setState({
      presets: [
        {
          id: "1",
          name: "A",
          type: "orbit",
          params: {},
          createdAt: "2026-01-01",
        },
        {
          id: "2",
          name: "B",
          type: "grid",
          params: {},
          createdAt: "2026-01-01",
        },
      ],
    });

    await useTemplatePresetsStore.getState().removePreset("1");

    expect(mockedApi.delete).toHaveBeenCalledWith("/template-presets/1");
    const { presets } = useTemplatePresetsStore.getState();
    expect(presets).toHaveLength(1);
    expect(presets[0].id).toBe("2");
  });
});
