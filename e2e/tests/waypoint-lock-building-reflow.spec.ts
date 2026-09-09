import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blockMapboxNetwork, dismissWelcomeDialogOnLoad } from "../helpers.js";
import { STORAGE_STATE_PATH } from "../global-setup.js";

test.use({ storageState: STORAGE_STATE_PATH });

/**
 * Draws a rectangular building in the middle of the map and turns it into an
 * orbit, which is the shortest route to a mission that has both a building and
 * a ring of waypoints tied to it — the situation the lock and the reflow exist
 * for.
 */
async function drawBuildingAndOrbit(page: Page) {
  const map = page.locator(".mapboxgl-canvas").first();
  await map.waitFor({ state: "visible", timeout: 20_000 });
  const box = await map.boundingBox();
  if (!box) throw new Error("Map canvas not visible");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.keyboard.press("h");
  const createMissionButton = page.getByRole("button", {
    name: "Vytvořit misi",
  });
  if (
    await createMissionButton.isVisible({ timeout: 5_000 }).catch(() => false)
  ) {
    await createMissionButton.click();
  }

  await page.mouse.move(cx - 110, cy - 70);
  await page.mouse.down();
  await page.mouse.move(cx + 110, cy + 70, { steps: 10 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Použít" }).last().click();

  // Same retry-until-painted dance as the building-menu spec: the fill layer
  // has to be rasterized before a click can find the building.
  const orbitFromMenu = page.getByRole("button", { name: "Vytvořit orbit" });
  await expect(async () => {
    await page.mouse.click(cx, cy);
    await expect(orbitFromMenu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await orbitFromMenu.click();
  await page.getByRole("button", { name: "Použít" }).last().click();

  // Waits on the map, not the sidebar: on a phone the panels start closed
  // (App's `panelsHidden` default), so the sidebar headings aren't rendered
  // and this helper has to work in both layouts.
  await expect
    .poll(() => page.locator(".mapboxgl-marker").count(), { timeout: 10_000 })
    .toBeGreaterThan(5);
  return { cx, cy };
}

test.describe("Waypoint locks and building reflow", () => {
  test("locking waypoints keeps them out of the reflow a building edit proposes", async ({
    page,
  }) => {
    await blockMapboxNetwork(page);
    await dismissWelcomeDialogOnLoad(page);
    await page.goto("/");
    await expect(page.getByPlaceholder("Název mise")).toBeVisible({
      timeout: 20_000,
    });

    const { cx, cy } = await drawBuildingAndOrbit(page);

    // Lock the first stretch of the route the way an operator would: click the
    // first row, shift-click a later one, then press the toolbar's lock.
    const firstRow = page.getByText("Bod trasy 1", { exact: true });
    const fourthRow = page.getByText("Bod trasy 4", { exact: true });
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    await firstRow.click();
    await fourthRow.click({ modifiers: ["Shift"] });

    // `exact` matters: every waypoint row carries its own padlock whose
    // tooltip also starts with "Zamknout".
    const lockButton = page.getByRole("button", {
      name: "Zamknout",
      exact: true,
    });
    await expect(lockButton).toBeVisible();
    await lockButton.click();
    await expect(
      page.getByRole("button", { name: "Odemknout", exact: true }),
    ).toBeVisible();

    // Clear the selection so the bulk toolbar doesn't cover the reflow bar.
    await page.keyboard.press("Escape");

    // Select the building so its vertex handles appear. Clicked off-centre on
    // purpose: the orbit put its POI marker at the building's centroid, and a
    // click there lands on the marker, not the building.
    const buildingMenuHeight = page.getByLabel("Výška budovy");
    await expect(async () => {
      await page.mouse.click(cx - 60, cy + 45);
      await expect(buildingMenuHeight).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    // The popup sits over one of the corners; close it before reaching for a
    // handle. The building stays selected, so the handles stay up.
    await page.locator(".mapboxgl-popup-close-button").first().click();
    await expect(buildingMenuHeight).toBeHidden();

    // Grow the footprint by dragging one corner outward — located through the
    // handle's own box rather than by guessing where it was drawn, since a
    // 12px target is not worth missing over rounding.
    // White fill picks the corner handles out from the pale-blue midpoint
    // ones, which sit on the same edges and are draggable too.
    const vertexHandle = page
      .locator('.mapboxgl-marker div[style*="background: rgb(255, 255, 255)"]')
      .first();
    await expect(vertexHandle).toBeVisible({ timeout: 10_000 });
    const handleBox = await vertexHandle.boundingBox();
    if (!handleBox) throw new Error("Building vertex handle not visible");
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 - 90,
      handleBox.y + handleBox.height / 2 - 70,
      { steps: 15 },
    );
    await page.mouse.up();

    const reflowBar = page.getByText("Budova změněna");
    await expect(reflowBar).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Zamčeno: 4/)).toBeVisible();
    await expect(page.getByText(/Posune se: \d+/)).toBeVisible();

    // Let the "locked N waypoints" toast clear first, so the screenshot shows
    // the bar rather than the toast sitting on top of it.
    await expect(page.getByText(/Zamčeno 4 bodů/)).toBeHidden({
      timeout: 15_000,
    });
    await page.screenshot({
      path: "docs/screenshots/building-reflow-bar.png",
    });

    await page.getByRole("button", { name: "Použít" }).last().click();
    await expect(reflowBar).toBeHidden({ timeout: 10_000 });
  });

  test("a typed range locks without hunting through the list, and a whole wall can be dragged", async ({
    page,
  }) => {
    await blockMapboxNetwork(page);
    await dismissWelcomeDialogOnLoad(page);
    await page.goto("/");
    await expect(page.getByPlaceholder("Název mise")).toBeVisible({
      timeout: 20_000,
    });

    const { cx, cy } = await drawBuildingAndOrbit(page);

    // Lock waypoints 1-4 by typing the range, the way an operator locks
    // "everything already filmed" on a 72-point orbit.
    const rangeLock = page.getByRole("button", { name: "Zamknout rozsah" });

    // An unusable range must not be clickable at all: a live-looking button
    // that quietly acts on the previous input leaves the operator believing
    // they locked something they didn't.
    await expect(page.getByLabel("Do bodu")).toHaveValue("");
    await expect(rangeLock).toBeDisabled();

    await page.getByLabel("Od bodu").fill("1");
    await page.getByLabel("Do bodu").fill("4");
    await expect(rangeLock).toBeEnabled();
    await rangeLock.click();
    await expect(page.getByText(/Zamčeno 4 bodů \(1–4\)/)).toBeVisible();

    // Clearing a field disables it again rather than re-running the old range.
    // Cleared by keyboard, the way an operator does it — a number input that
    // is emptied programmatically does not always tell React about it.
    await page.getByLabel("Do bodu").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await expect(page.getByLabel("Do bodu")).toHaveValue("");
    await expect(rangeLock).toBeDisabled();
    // A range entirely past the end of the mission names no waypoints. (A
    // range that merely overshoots — 1 to 900 on a 12-point route — is a
    // legitimate "to the end" and stays enabled.)
    await page.getByLabel("Od bodu").fill("900");
    await page.getByLabel("Do bodu").fill("999");
    await expect(rangeLock).toBeDisabled();
    await page.getByLabel("Od bodu").fill("1");
    await page.getByLabel("Do bodu").fill("4");
    await expect(rangeLock).toBeEnabled();

    // Select the building, off-centre so the orbit's POI marker doesn't take
    // the click.
    const buildingMenuHeight = page.getByLabel("Výška budovy");
    await expect(async () => {
      await page.mouse.click(cx - 60, cy + 45);
      await expect(buildingMenuHeight).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.locator(".mapboxgl-popup-close-button").first().click();

    // Drag a whole wall by its midpoint handle — pale blue, as against the
    // white corner handles.
    const edgeHandle = page
      .locator('.mapboxgl-marker div[style*="background: rgb(191, 219, 254)"]')
      .first();
    await expect(edgeHandle).toBeVisible({ timeout: 10_000 });
    const edgeBox = await edgeHandle.boundingBox();
    if (!edgeBox) throw new Error("Building edge handle not visible");
    const ex = edgeBox.x + edgeBox.width / 2;
    const ey = edgeBox.y + edgeBox.height / 2;
    await page.mouse.move(ex, ey);
    await page.mouse.down();
    await page.mouse.move(ex - 70, ey - 55, { steps: 15 });
    await page.mouse.up();

    await expect(page.getByText("Budova změněna")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Zamčeno: 4/)).toBeVisible();

    // The ramp control only makes sense when something is locked, and it is.
    const blend = page.getByLabel("Přechod");
    await expect(blend).toBeVisible();
    await expect(blend).toHaveValue("8");

    await page.getByRole("button", { name: "Použít" }).last().click();
    await expect(page.getByText("Budova změněna")).toBeHidden({
      timeout: 10_000,
    });
  });

  test("both bottom bars stay inside a 375px viewport, with every button reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await blockMapboxNetwork(page);
    await dismissWelcomeDialogOnLoad(page);
    await page.goto("/");
    // A phone opens straight into the map with the panels closed (see App's
    // `panelsHidden` default), so wait on the canvas, not the sidebar.
    await page
      .locator(".mapboxgl-canvas")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });

    await drawBuildingAndOrbit(page);

    await page.getByRole("button", { name: "Zobrazit panely (Tab)" }).click();
    const firstRow = page.getByText("Bod trasy 1", { exact: true });
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    await firstRow.click();
    await page
      .getByText("Bod trasy 3", { exact: true })
      .click({ modifiers: ["Shift"] });

    // The selection bar outgrew a phone once it gained the lock button. It may
    // scroll horizontally, but it must not lay itself out past the viewport
    // with buttons stranded off-screen where nothing can reach them.
    const selectionBar = page
      .getByText("Vybráno:")
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    const barBox = await selectionBar.boundingBox();
    expect(barBox).not.toBeNull();
    expect(barBox!.x).toBeGreaterThanOrEqual(-1);
    expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(376);

    // The range row lives inside that ~318px drawer. Its buttons have to stay
    // inside it: anything sticking out lands on the drawer's own backdrop,
    // where a click closes the panel instead of locking waypoints.
    const drawer = page.locator('div[class*="w-[85vw]"]').first();
    const drawerBox = await drawer.boundingBox();
    for (const name of ["Zamknout rozsah", "Odemknout rozsah"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box, `${name} has no box`).not.toBeNull();
      expect(
        box!.x + box!.width,
        `${name} escapes the drawer`,
      ).toBeLessThanOrEqual(drawerBox!.x + drawerBox!.width + 1);
    }

    // On a phone the sidebar is a drawer covering most of the screen, so close
    // it before reaching for the bar underneath — that's the order an operator
    // works in too.
    await page.getByRole("button", { name: /Skrýt panely/ }).click();

    // Playwright scrolls a target into its scroll container before clicking, so
    // a successful click on the far-right button is the real reachability test.
    await page.getByRole("button", { name: "Zamknout", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Odemknout", exact: true }),
    ).toBeVisible();

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("mapbox")) {
        errors.push(msg.text());
      }
    });
    expect(errors).toEqual([]);
  });
});
