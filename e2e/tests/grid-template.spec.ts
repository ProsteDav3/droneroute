import { test, expect } from "@playwright/test";
import { blockMapboxNetwork, dismissWelcomeDialogOnLoad } from "../helpers.js";
import { STORAGE_STATE_PATH } from "../global-setup.js";

test.use({ storageState: STORAGE_STATE_PATH });

test.describe("Grid survey template", () => {
  test("draws a grid area and applies it, generating waypoints", async ({
    page,
  }) => {
    await blockMapboxNetwork(page);
    await dismissWelcomeDialogOnLoad(page);

    await page.goto("/");
    await expect(page.getByPlaceholder("Název mise")).toBeVisible({
      timeout: 20_000,
    });

    const map = page.locator(".mapboxgl-canvas").first();
    await map.waitFor({ state: "visible", timeout: 20_000 });
    const box = await map.boundingBox();
    if (!box) throw new Error("Map canvas not visible");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const waypointsHeading = page.getByText(/^Body trasy \(\d+\)$/);
    await expect(waypointsHeading).toHaveText("Body trasy (0)");

    // "g" enters grid-template drawing mode, then drag out a rectangle.
    await page.keyboard.press("g");
    await page.mouse.move(cx - 150, cy - 100);
    await page.mouse.down();
    await page.mouse.move(cx + 150, cy + 100, { steps: 10 });
    await page.mouse.up();

    // The template config panel appears with an "Použít" (Apply) button
    // once a valid area has been drawn. The panel also has a smaller
    // "Použít [doporučený překryv]" shortcut with the same accessible name
    // ("Použít" alone) — the main Apply action is the last "Použít" button
    // in the panel (the primary purple action button at the bottom).
    const applyButton = page.getByRole("button", { name: "Použít" }).last();
    await applyButton.waitFor({ state: "visible", timeout: 10_000 });
    await applyButton.click();

    // Applying the template replaces the mission's waypoints with the
    // generated grid pattern — any non-zero count confirms the template
    // actually generated a route (exact count depends on drawn area size
    // and default grid spacing, which aren't asserted here to avoid
    // over-fitting the test to incidental defaults).
    await expect(waypointsHeading).not.toHaveText("Body trasy (0)", {
      timeout: 10_000,
    });
  });
});
