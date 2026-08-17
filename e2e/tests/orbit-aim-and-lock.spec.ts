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

  test("merely focusing and leaving the aim-height field does not pin it — it keeps following the object", async ({
    page,
  }) => {
    // The bug this guards: NumericInput reported onChange on blur even when
    // nothing was typed, so tabbing through "Mířit na výšku" silently turned
    // automatic (half the object) into an explicit value. A user's orbit
    // ended up with the aim pinned to the object's full height and no way
    // to see why re-applying the template wouldn't move it.
    await drawOrbit(page);

    await field(page, "Výška objektu").fill("20");
    await field(page, "Výška objektu").blur();
    await expect(field(page, "Mířit na výšku")).toHaveValue("10");
    // Still automatic: no "auto" reset button is offered.
    await expect(
      page.getByRole("button", { name: "auto", exact: true }),
    ).toHaveCount(0);

    // Click into the aim field and leave without typing.
    await field(page, "Mířit na výšku").focus();
    await field(page, "Mířit na výšku").blur();
    await expect(
      page.getByRole("button", { name: "auto", exact: true }),
    ).toHaveCount(0);

    // Proof it is still following: change the object height and the aim
    // must track to the new middle. A pinned value would have stayed at 10.
    await field(page, "Výška objektu").fill("30");
    await field(page, "Výška objektu").blur();
    await expect(field(page, "Mířit na výšku")).toHaveValue("15");

    // Typing a value DOES pin it — and "auto" then brings it back.
    await field(page, "Mířit na výšku").fill("30");
    await field(page, "Mířit na výšku").blur();
    await expect(
      page.getByRole("button", { name: "auto", exact: true }),
    ).toBeVisible();
    await field(page, "Výška objektu").fill("40");
    await field(page, "Výška objektu").blur();
    await expect(field(page, "Mířit na výšku")).toHaveValue("30");
    await page.getByRole("button", { name: "auto", exact: true }).click();
    await expect(field(page, "Mířit na výšku")).toHaveValue("20");
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

  test("shows fit and ideal ranges under radius and altitude, and flags a value outside them", async ({
    page,
  }) => {
    await drawOrbit(page);

    // No object yet -> nothing to frame -> no hints.
    await expect(page.getByText(/vejde se/)).toHaveCount(0);

    await field(page, "Výška objektu").fill("60");
    await field(page, "Výška objektu").blur();

    // Both hints appear once there's an object, and read as "fits from N ·
    // ideally A–B" — the shape the user asked for.
    const hints = page.getByText(/vejde se/);
    await expect(hints).toHaveCount(2);
    await expect(hints.first()).toContainText("✓");
    await expect(hints.first()).toContainText(/ideálně \d+–\d+/);

    // Lock the altitude and drop it low; a 60m building from a small radius
    // then no longer fits, and the radius hint must say so — amber, with a
    // cross — instead of staying a calm grey.
    await page.getByRole("button", { name: /Zamkne výšku letu/ }).click();
    await field(page, "Výška letu").fill("20");
    await field(page, "Výška letu").blur();
    await field(page, "Radius").fill("10");
    await field(page, "Radius").blur();

    const radiusHint = page.getByText(/vejde se/).first();
    await expect(radiusHint).toContainText("✗");
    await expect(radiusHint).toHaveClass(/text-amber-400/);
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

  test("cinema video is offered, selectable, and reflected in the flight-time estimate", async ({
    page,
  }) => {
    await drawOrbit(page);

    const cinema = page.getByRole("button", { name: "Cinema video" });
    await expect(cinema).toBeVisible();

    // Reading the flight-time estimate off the sidebar before/after: 3 m/s
    // over the same loop must take longer than the 5 m/s default. The
    // sidebar prints "Nm Ss celkem"; parse it to seconds.
    const totalTime = async () => {
      const text = await page
        .getByText(/celkem/)
        .first()
        .textContent();
      const m = /(?:(\d+)m\s*)?(\d+)s/.exec(text ?? "");
      if (!m) throw new Error(`no time in "${text}"`);
      return Number(m[1] ?? 0) * 60 + Number(m[2]);
    };

    await page.getByRole("button", { name: "Použít" }).last().click();
    await expect(page.getByText(/^Body trasy \(\d+\)$/)).not.toHaveText(
      "Body trasy (0)",
      { timeout: 10_000 },
    );
    const normalSeconds = await totalTime();

    // Re-open the template for editing and switch to cinema pacing.
    await page.keyboard.press("Control+z");
    await expect(page.getByText(/^Body trasy \(\d+\)$/)).toHaveText(
      "Body trasy (0)",
    );
    await drawOrbit(page);
    await page.getByRole("button", { name: "Cinema video" }).click();
    await expect(
      page.getByRole("button", { name: "Cinema video" }),
    ).toHaveClass(/text-\[#33cfff\]/);
    await page.getByRole("button", { name: "Použít" }).last().click();
    await expect(page.getByText(/^Body trasy \(\d+\)$/)).not.toHaveText(
      "Body trasy (0)",
      { timeout: 10_000 },
    );
    const cinemaSeconds = await totalTime();

    expect(cinemaSeconds).toBeGreaterThan(normalSeconds);
  });

  test("with a locked POI the panel reports the near/far swing over the flown waypoints", async ({
    page,
  }) => {
    await drawOrbit(page);
    await field(page, "Výška objektu").fill("9");
    await field(page, "Výška objektu").blur();
    await page.getByLabel("Uzamknout POI").check();

    // Readout appears once a POI is locked; the POI is at the centre, so
    // every waypoint is one radius away and the swing is 1.0×.
    const swing = page.getByText(/Vzdálenost od cíle/);
    await expect(swing).toBeVisible();
    await expect(swing).toContainText(/1\.0×/);
    const radiusM = Number(await field(page, "Radius").inputValue());
    await expect(swing).toContainText(new RegExp(`${radiusM}–${radiusM} m`));

    // Move the POI's target off-centre by shrinking the circle around it via
    // the address/centre field is not available headless; instead widen the
    // circle: with the POI pinned where it was, changing the radius keeps it
    // centred, so the swing must stay 1.0× — proving the readout tracks the
    // real geometry rather than a stale value.
    await field(page, "Radius").fill(String(radiusM + 40));
    await field(page, "Radius").blur();
    await expect(swing).toContainText(
      new RegExp(`${radiusM + 40}–${radiusM + 40} m`),
    );
    await expect(swing).toContainText(/1\.0×/);

    // Values are whole metres — no float noise like 214.9999999.
    const text = (await swing.textContent()) ?? "";
    expect(text).not.toMatch(/\d\.\d{3,}/);
  });

  test("blocks Apply when a waypoint would come closer to the locked target than the object needs", async ({
    page,
  }) => {
    await drawOrbit(page);
    await field(page, "Výška objektu").fill("30");
    await field(page, "Výška objektu").blur();
    await page.getByLabel("Uzamknout POI").check();

    const apply = page.getByRole("button", { name: "Použít" }).last();
    const warning = page.getByText(/od cíle kamery/);
    await expect(apply).toBeEnabled();
    await expect(warning).toHaveCount(0);

    // Shrink the circle until the waypoints are inside the standoff a 30 m
    // object needs. The POI is at the centre here, so every waypoint sits at
    // exactly the radius — an unambiguous way to cross the threshold.
    await field(page, "Radius").fill("8");
    await field(page, "Radius").blur();

    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/Bod trasy \d+ je jen \d+ m/);
    await expect(warning).toContainText(/potřeba aspoň \d+ m/);
    await expect(apply).toBeDisabled();

    // Backing off releases it again.
    await field(page, "Radius").fill("120");
    await field(page, "Radius").blur();
    await expect(warning).toHaveCount(0);
    await expect(apply).toBeEnabled();
  });

  test("a tall object still blocks Apply, but only for its height — the block message says so", async ({
    page,
  }) => {
    await drawOrbit(page);
    await field(page, "Výška objektu").fill("40");
    await field(page, "Výška objektu").blur();
    await page.getByLabel("Uzamknout POI").check();

    const apply = page.getByRole("button", { name: "Použít" }).last();
    await field(page, "Radius").fill("10");
    await field(page, "Radius").blur();
    const block = page.getByText(/nevejde ani na výšku/);
    await expect(block).toBeVisible();
    await expect(apply).toBeDisabled();

    // Backing off past the HEIGHT requirement releases it — it must not also
    // demand the room a long building's length would need.
    await field(page, "Radius").fill("60");
    await field(page, "Radius").blur();
    await expect(block).toHaveCount(0);
    await expect(apply).toBeEnabled();
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
