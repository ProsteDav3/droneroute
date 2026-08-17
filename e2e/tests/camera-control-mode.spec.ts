import { test, expect } from "@playwright/test";
import { blockMapboxNetwork, dismissWelcomeDialogOnLoad } from "../helpers.js";
import { STORAGE_STATE_PATH } from "../global-setup.js";

test.use({ storageState: STORAGE_STATE_PATH });

test.describe("Camera control mode", () => {
  test("switches between auto and manual, and says what manual does", async ({
    page,
  }) => {
    await blockMapboxNetwork(page);
    await dismissWelcomeDialogOnLoad(page);

    await page.goto("/");
    await expect(page.getByPlaceholder("Název mise")).toBeVisible({
      timeout: 20_000,
    });

    await page.getByText("NASTAVENÍ MISE").click();

    const auto = page.getByRole("button", { name: "Automaticky" });
    const manual = page.getByRole("button", { name: "Ručně", exact: true });
    await expect(auto).toHaveAttribute("aria-pressed", "true");
    await expect(manual).toHaveAttribute("aria-pressed", "false");

    await manual.click();
    await expect(manual).toHaveAttribute("aria-pressed", "true");
    await expect(auto).toHaveAttribute("aria-pressed", "false");
    // The consequence is stated where the choice is made — the plan's aiming
    // stays saved but is left out of the exported KMZ.
    await expect(page.getByText(/do KMZ se nezapíše/)).toBeVisible();

    await auto.click();
    await expect(auto).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/do KMZ se nezapíše/)).toHaveCount(0);
  });
});
