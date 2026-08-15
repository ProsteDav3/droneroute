import { test, expect, type Page } from "@playwright/test";
import { blockMapboxNetwork, dismissWelcomeDialogOnLoad } from "../helpers.js";
import { STORAGE_STATE_PATH } from "../global-setup.js";

test.use({ storageState: STORAGE_STATE_PATH });

const field = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true });

/** Draws an orbit on the map so its config panel is open and populated. */
async function drawOrbit(page: Page) {
  await blockMapboxNetwork(page);
  await dismissWelcomeDialogOnLoad(page);

  await page.goto("/");

  // Gate on the map, not the sidebar: below roughly tablet width the app
  // collapses its side panels behind a toggle, so waiting on a sidebar
  // field would hang at mobile viewports even though the editor is up.
  const map = page.locator(".mapboxgl-canvas").first();
  await map.waitFor({ state: "visible", timeout: 20_000 });
  const box = await map.boundingBox();
  if (!box) throw new Error("Map canvas not visible");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // "o" enters orbit-drawing mode; on a fresh unsaved mission it first asks
  // which drone the mission flies (same flow as the grid spec).
  await page.keyboard.press("o");
  const createMissionButton = page.getByRole("button", {
    name: "Vytvořit misi",
  });
  await createMissionButton.waitFor({ state: "visible", timeout: 10_000 });
  await createMissionButton.click();

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 10 });
  await page.mouse.up();

  await expect(field(page, "Radius")).toBeVisible({ timeout: 10_000 });
}

test.describe("Orbit aim height and altitude lock", () => {
  test("aim height defaults to the middle of the object and is taken literally once set", async ({
    page,
  }) => {
    await drawOrbit(page);

    await field(page, "Výška objektu").fill("20");
    await field(page, "Výška objektu").blur();

    // Untouched, the aim follows the object: half of 20.
    await expect(field(page, "Mířit na výšku")).toHaveValue("10");

    // Typed in, it is taken literally — aiming at the roof, not at half the
    // roof. The pitch must follow that, not the object's full height.
    await field(page, "Mířit na výšku").fill("20");
    await field(page, "Mířit na výšku").blur();
    await expect(field(page, "Mířit na výšku")).toHaveValue("20");

    const altitude = Number(await field(page, "Výška letu").inputValue());
    const radius = Number(await field(page, "Radius").inputValue());
    const expectedPitch = -Math.round(
      (Math.atan2(altitude - 20, radius) * 180) / Math.PI,
    );
    await expect(field(page, "Náklon gimbalu")).toHaveValue(
      String(expectedPitch),
    );
  });

  test("locking the altitude makes a radius change move only the gimbal", async ({
    page,
  }) => {
    await drawOrbit(page);

    await field(page, "Výška objektu").fill("20");
    await field(page, "Výška objektu").blur();

    const lockedAltitude = await field(page, "Výška letu").inputValue();
    const pitchBefore = await field(page, "Náklon gimbalu").inputValue();

    await page.getByRole("button", { name: /Zamkne výšku letu/ }).click();

    await field(page, "Radius").fill("120");
    await field(page, "Radius").blur();

    // The whole point: altitude held, camera re-aimed.
    await expect(field(page, "Výška letu")).toHaveValue(lockedAltitude);
    await expect(field(page, "Náklon gimbalu")).not.toHaveValue(pitchBefore);
  });

  test("retyping the displayed gimbal pitch does not move the drone", async ({
    page,
  }) => {
    await drawOrbit(page);

    await field(page, "Výška objektu").fill("20");
    await field(page, "Výška objektu").blur();

    const altitudeBefore = await field(page, "Výška letu").inputValue();
    const shownPitch = await field(page, "Náklon gimbalu").inputValue();

    // Typing back the very same angle the panel is showing used to solve
    // against the object's full height instead of the aim height, shoving
    // the altitude several metres up for no reason.
    await field(page, "Náklon gimbalu").fill(shownPitch);
    await field(page, "Náklon gimbalu").blur();

    await expect(field(page, "Výška letu")).toHaveValue(altitudeBefore);
    await expect(field(page, "Náklon gimbalu")).toHaveValue(shownPitch);
  });

  test("stays usable at 375px wide, with no console errors", async ({
    page,
  }) => {
    // Uncaught exceptions are the signal that actually means something here.
    // Console errors alone are not: this suite blocks Mapbox's network on
    // purpose, so every style/tile request logs a resource failure that
    // belongs to the harness rather than to the app.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (/mapbox|net::ERR_FAILED|Content Security Policy/i.test(text)) return;
      consoleErrors.push(text);
    });

    await page.setViewportSize({ width: 375, height: 720 });
    await drawOrbit(page);

    // Visible is not the same as reachable: the floating map toolbar sits at
    // the right edge and the panel is only ~340px wide, so at this width they
    // share space. Typing into the fields forces Playwright's actionability
    // check, which fails if anything covers them — a plain visibility
    // assertion would pass right through an overlap.
    await field(page, "Výška objektu").fill("20");
    await expect(field(page, "Mířit na výšku")).toHaveValue("10");
    await field(page, "Mířit na výšku").fill("15");
    await expect(field(page, "Mířit na výšku")).toHaveValue("15");

    await page.getByRole("button", { name: /Zamkne výšku letu/ }).click();
    await expect(
      page.getByRole("button", { name: /Výška letu je zamčená/ }),
    ).toBeVisible();

    // Nothing may push the page itself into horizontal scrolling.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("applies the orbit and generates waypoints", async ({ page }) => {
    await drawOrbit(page);

    const waypointsHeading = page.getByText(/^Body trasy \(\d+\)$/);
    await expect(waypointsHeading).toHaveText("Body trasy (0)");

    await page.getByRole("button", { name: "Použít" }).last().click();

    await expect(waypointsHeading).not.toHaveText("Body trasy (0)", {
      timeout: 10_000,
    });
  });
});
