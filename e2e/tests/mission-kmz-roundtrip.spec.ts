import { test, expect } from "@playwright/test";
import os from "os";
import path from "path";
import {
  blockMapboxNetwork,
  clickOnMap,
  dismissWelcomeDialogOnLoad,
} from "../helpers.js";
import { STORAGE_STATE_PATH } from "../global-setup.js";

test.use({ storageState: STORAGE_STATE_PATH });

test.describe("Mission creation and KMZ export/import round-trip", () => {
  test("creates a mission with waypoints, exports KMZ, and re-imports it with the same waypoint count", async ({
    page,
  }) => {
    await blockMapboxNetwork(page);
    await dismissWelcomeDialogOnLoad(page);

    await page.goto("/");
    await expect(page.getByPlaceholder("Název mise")).toBeVisible({
      timeout: 20_000,
    });

    // Wait for the map canvas to actually mount before clicking on it.
    await page.locator(".mapboxgl-canvas").first().waitFor({
      state: "visible",
      timeout: 20_000,
    });

    // Add 3 waypoints via the "w" keyboard shortcut + map clicks (mirrors
    // real user interaction, not a store-level shortcut).
    await page.keyboard.press("w");
    await clickOnMap(page, -120, -60);
    await clickOnMap(page, 0, -100);
    await clickOnMap(page, 120, -40);
    await page.keyboard.press("Escape");

    const waypointsHeading = page.getByText(/^Body trasy \(\d+\)$/);
    await expect(waypointsHeading).toHaveText("Body trasy (3)");

    // Export KMZ and capture the download.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export KMZ/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.kmz$/);

    const downloadPath = path.join(
      os.tmpdir(),
      `droneroute-e2e-${test.info().workerIndex}-${Date.now()}.kmz`,
    );
    await download.saveAs(downloadPath);

    // Start a brand new mission so the re-import below can't accidentally
    // pass just because the 3 waypoints were already on the map.
    await page.reload();
    await page.locator(".mapboxgl-canvas").first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await expect(waypointsHeading).toHaveText("Body trasy (0)");

    // Re-import the exported KMZ and confirm the waypoint count round-trips.
    const fileInput = page.locator('input[type="file"][accept=".kmz"]');
    await fileInput.setInputFiles(downloadPath);
    await expect(waypointsHeading).toHaveText("Body trasy (3)", {
      timeout: 10_000,
    });
  });
});
