import { test, expect } from "@playwright/test";
import {
  TEST_USER,
  blockMapboxNetwork,
  dismissWelcomeDialogOnLoad,
} from "../helpers.js";

// Deliberately does NOT use the shared storage state — this spec exercises
// the actual sign-in UI. Registration itself is covered once, globally, by
// global-setup.ts (self-hosted registration only ever succeeds for the
// first account on a fresh database), so this test logs in with that same
// bootstrapped account instead of registering a second one.
test.describe("Login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signs in with email and password and reaches the main editor", async ({
    page,
  }) => {
    await blockMapboxNetwork(page);
    await dismissWelcomeDialogOnLoad(page);

    await page.goto("/");

    // Registration is closed (global-setup already bootstrapped the founder
    // account), so LoginGate shows the regular sign-in form, not the
    // bootstrap/registration one.
    const emailInput = page.locator("#gate-email");
    await emailInput.waitFor({ state: "visible", timeout: 20_000 });
    await emailInput.fill(TEST_USER.email);
    await page.locator("#gate-password").fill(TEST_USER.password);
    await page.getByRole("button", { name: "Přihlásit se" }).click();

    // "Název mise" only exists in the authenticated editor view — LoginGate
    // itself also displays a "SkyRoute" heading, so that alone wouldn't
    // distinguish "still on the gate" from "signed in".
    await expect(page.getByPlaceholder("Název mise")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("rejects an incorrect password", async ({ page }) => {
    await blockMapboxNetwork(page);
    await dismissWelcomeDialogOnLoad(page);

    await page.goto("/");

    const emailInput = page.locator("#gate-email");
    await emailInput.waitFor({ state: "visible", timeout: 20_000 });
    await emailInput.fill(TEST_USER.email);
    await page.locator("#gate-password").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Přihlásit se" }).click();

    await expect(page.getByText("Neplatný e-mail nebo heslo")).toBeVisible({
      timeout: 10_000,
    });
  });
});
