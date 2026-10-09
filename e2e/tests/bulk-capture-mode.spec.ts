import fs from "fs";
import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import {
  DEFAULT_MISSION_CONFIG,
  DEFAULT_WAYPOINT,
  type Waypoint,
} from "@droneroute/shared";
import { blockMapboxNetwork, dismissWelcomeDialogOnLoad } from "../helpers.js";
import { STORAGE_STATE_PATH } from "../global-setup.js";

test.use({ storageState: STORAGE_STATE_PATH });

const ORBIT_POINTS = 72;

/**
 * Writes a 72-point video orbit as a real DJI KMZ, produced by the app's own
 * export endpoint — recording starts on the first waypoint and stops on the
 * last, the shape a video mission has once it comes back from DJI Pilot.
 * Generated rather than checked in: `*.kmz` is gitignored and real missions
 * are client data, which has no place in a public repo. Placed at the
 * AGENTS.md standard screenshot coordinates.
 */
async function writeVideoOrbitKmz(
  request: APIRequestContext,
  filePath: string,
): Promise<string> {
  const center = { lat: 41.25797725781744, lng: 0.9322907667035154 };
  const radiusM = 100;
  const waypoints: Waypoint[] = Array.from({ length: ORBIT_POINTS }, (_, i) => {
    const bearing = (2 * Math.PI * i) / ORBIT_POINTS;
    const record =
      i === 0 ? "startRecord" : i === ORBIT_POINTS - 1 ? "stopRecord" : null;
    return {
      ...DEFAULT_WAYPOINT,
      index: i,
      name: `Bod trasy ${i + 1}`,
      latitude:
        center.lat +
        ((radiusM * Math.cos(bearing)) / 6_371_000) * (180 / Math.PI),
      longitude:
        center.lng +
        ((radiusM * Math.sin(bearing)) /
          (6_371_000 * Math.cos((center.lat * Math.PI) / 180))) *
          (180 / Math.PI),
      height: 50,
      gimbalPitchAngle: -17,
      actions: record
        ? [
            {
              actionId: 0,
              actionType: record,
              params: { payloadPositionIndex: 0 },
            },
          ]
        : [],
    };
  });
  const res = await request.post("/api/kmz/generate", {
    data: {
      name: "video-orbit",
      config: DEFAULT_MISSION_CONFIG,
      waypoints,
      pois: [],
    },
  });
  expect(res.ok(), `KMZ export failed: ${res.status()}`).toBe(true);
  fs.writeFileSync(filePath, await res.body());
  return filePath;
}

test("an imported KMZ can be switched between video and photo from the bulk editor", async ({
  page,
}) => {
  const kmz = await writeVideoOrbitKmz(
    page.request,
    test.info().outputPath("video-orbit.kmz"),
  );
  await blockMapboxNetwork(page);
  await dismissWelcomeDialogOnLoad(page);
  await page.goto("/");
  await expect(page.getByPlaceholder("Název mise")).toBeVisible({
    timeout: 20_000,
  });

  await page.locator('input[type="file"][accept=".kmz"]').setInputFiles(kmz);
  await expect(page.getByText(/^Body trasy \(\d+\)$/)).toHaveText(
    `Body trasy (${ORBIT_POINTS})`,
    { timeout: 10_000 },
  );

  // Ctrl+A only reaches the editor when focus isn't in a text field. Not a
  // map click: the editor opens in add-waypoint mode, so that would add a 73rd.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByText(`Vybráno: ${ORBIT_POINTS}`)).toBeVisible();
  await page.getByRole("button", { name: "Upravit", exact: true }).click();

  const foto = page.getByRole("button", { name: "Foto", exact: true });
  const video = page.getByRole("button", { name: "Video", exact: true });
  const cinema = page.getByRole("button", { name: "Cinema video" });

  // The file's own start/stop recording is recognised as video.
  await expect(video).toHaveAttribute("aria-pressed", "true");

  await foto.click();
  await expect(foto).toHaveAttribute("aria-pressed", "true");
  await expect(video).toHaveAttribute("aria-pressed", "false");

  await cinema.click();
  await expect(cinema).toHaveAttribute("aria-pressed", "true");
  await expect(foto).toHaveAttribute("aria-pressed", "false");
});

test("on a 375px phone the capture choice is reachable right after selecting in the sidebar drawer", async ({
  page,
}) => {
  const kmz = await writeVideoOrbitKmz(
    page.request,
    test.info().outputPath("video-orbit.kmz"),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await blockMapboxNetwork(page);
  await dismissWelcomeDialogOnLoad(page);
  await page.goto("/");
  await page
    .locator(".mapboxgl-canvas")
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });

  // A phone opens with the panels closed; the drawer holds both the import
  // button and the waypoint list the selection is made in.
  await page.getByRole("button", { name: "Zobrazit panely (Tab)" }).click();
  await page.locator('input[type="file"][accept=".kmz"]').setInputFiles(kmz);
  await expect(page.getByText(/^Body trasy \(\d+\)$/)).toHaveText(
    `Body trasy (${ORBIT_POINTS})`,
    { timeout: 10_000 },
  );

  await page.getByText("Bod trasy 1", { exact: true }).click();
  await page
    .getByText("Bod trasy 3", { exact: true })
    .click({ modifiers: ["Shift"] });
  await expect(page.getByText("Vybráno: 3")).toBeVisible();

  // The bar gets the phone's full width to wrap into. Centred by a left:50%
  // offset it was only ever offered the right half of the screen, and folded
  // into a one-button-per-line column over the waypoint list.
  const bar = page
    .getByText("Vybráno:")
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  expect(barBox!.width).toBeGreaterThan(300);
  expect(barBox!.height).toBeLessThan(140);

  // "Upravit" has to be on screen as the bar lays out, not parked past the
  // right edge behind a horizontal scroll nobody knows to try on a phone.
  const upravit = page.getByRole("button", { name: "Upravit", exact: true });
  const box = await upravit.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);

  // The drawer stays open: these clicks must land on the bar, not on the
  // drawer or its backdrop (which would just close the panel).
  await upravit.click();
  const foto = page.getByRole("button", { name: "Foto", exact: true });
  await foto.click();
  await expect(foto).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(`Body trasy (${ORBIT_POINTS})`)).toBeVisible();

  // Photos on WP1-3 drop the import's startRecord on WP1 while its stop on
  // WP72 remains — the editor says so instead of exporting a stray stop.
  await expect(
    page.getByText(/Na WP72 se zastavuje nahrávání, které neběží/),
  ).toBeVisible();
});
