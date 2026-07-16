import { test, expect } from "@playwright/test";
import { blockMapboxNetwork, dismissWelcomeDialogOnLoad } from "../helpers.js";
import { STORAGE_STATE_PATH } from "../global-setup.js";

test.use({
  storageState: STORAGE_STATE_PATH,
  viewport: { width: 1280, height: 720 },
});

test.describe("Visual regression — main editor view", () => {
  test("matches the baseline screenshot", async ({ page }) => {
    await blockMapboxNetwork(page);
    await dismissWelcomeDialogOnLoad(page);

    await page.goto("/");
    await expect(page.getByPlaceholder("Název mise")).toBeVisible({
      timeout: 20_000,
    });
    await page.locator(".mapboxgl-canvas").first().waitFor({
      state: "visible",
      timeout: 20_000,
    });

    // Let the map settle (initial fly-to / resize handling) before capturing.
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot("editor.png", {
      // The map canvas is masked out: it's a live WebGL surface whose exact
      // pixels vary by GPU/driver/font rendering between machines and CI
      // runners, even with network-mocked tiles (see helpers.ts). Masking
      // keeps this test meaningful (sidebar, toolbar, layout, typography)
      // without becoming a perpetual source of environment-specific flakes.
      mask: [page.locator(".mapboxgl-canvas")],
      maskColor: "#0f172a",
      maxDiffPixelRatio: 0.02,
    });
  });
});
