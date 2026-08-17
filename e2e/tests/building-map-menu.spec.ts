import { test, expect } from "@playwright/test";
import { blockMapboxNetwork, dismissWelcomeDialogOnLoad } from "../helpers.js";
import { STORAGE_STATE_PATH } from "../global-setup.js";

test.use({ storageState: STORAGE_STATE_PATH });

test.describe("Building menu on the map", () => {
  test("clicking a building opens its menu, and the menu creates an orbit around it", async ({
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

    // "h" enters building drawing mode; a fresh unsaved mission asks which
    // drone it flies with first (same gate the grid spec documents).
    await page.keyboard.press("h");
    const createMissionButton = page.getByRole("button", {
      name: "Vytvořit misi",
    });
    if (
      await createMissionButton.isVisible({ timeout: 5_000 }).catch(() => false)
    ) {
      await createMissionButton.click();
    }

    // Rectangle mode is the default: drag two opposite corners.
    await page.mouse.move(cx - 120, cy - 80);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 80, { steps: 10 });
    await page.mouse.up();

    await page.getByRole("button", { name: "Použít" }).last().click();
    await expect(page.getByText(/^BUDOVY \(1\)$/i)).toBeVisible({
      timeout: 10_000,
    });

    // The point of the feature: click the building itself, not its sidebar
    // row, and get its actions on the spot.
    await page.mouse.click(cx, cy);
    const orbitFromMenu = page.getByRole("button", { name: "Vytvořit orbit" });
    await expect(orbitFromMenu).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Odebrat budovu" }),
    ).toBeVisible();
    await expect(page.getByLabel("Výška budovy")).toBeVisible();

    await page.screenshot({
      path: "docs/screenshots/building-map-menu.png",
      clip: {
        x: box.x + box.width / 2 - 320,
        y: box.y + box.height / 2 - 280,
        width: 640,
        height: 560,
      },
    });

    await orbitFromMenu.click();

    // The orbit panel opens pre-filled for this building — same result as the
    // sidebar's orbit icon, which is what the menu is a shortcut for.
    const radius = page.getByLabel("Radius");
    await expect(radius).toBeVisible({ timeout: 10_000 });
    // Pre-filled from the building's own footprint, not left blank or at the
    // bare template default.
    await expect(radius).not.toHaveValue("");
    await expect(page.getByLabel("Výška objektu")).not.toHaveValue("0");
    // And the menu closes behind it rather than sitting over the panel.
    await expect(orbitFromMenu).toHaveCount(0);
  });
});
