import { test, expect } from "@playwright/test";
import { blockMapboxNetwork, loginViaApi } from "../helpers.js";
import { STORAGE_STATE_PATH } from "../global-setup.js";

test.use({
  storageState: STORAGE_STATE_PATH,
  viewport: { width: 1280, height: 720 },
});

const FIXED_MISSION_NAMES = [
  "Vizuální regrese — Průmyslová hala",
  "Vizuální regrese — Fasáda budovy",
];

test.describe("Visual regression — mission list (Moje trasy)", () => {
  test.beforeEach(async ({ request, baseURL }) => {
    // Deterministic dataset: wipe out anything left over from a previous
    // (possibly retried) run, then create exactly the same 2 fixed missions
    // every time, so the list's content never depends on execution order or
    // on what other specs happened to save.
    const token = await loginViaApi(request, baseURL!);
    const authHeader = { Authorization: `Bearer ${token}` };

    const existing = await request.get(`${baseURL}/api/missions`, {
      headers: authHeader,
    });
    for (const mission of await existing.json()) {
      await request.delete(`${baseURL}/api/missions/${mission.id}`, {
        headers: authHeader,
      });
    }

    for (const name of FIXED_MISSION_NAMES) {
      await request.post(`${baseURL}/api/missions`, {
        headers: authHeader,
        data: {
          name,
          config: {
            droneEnumValue: 91,
            droneSubEnumValue: 1,
            autoFlightSpeed: 8,
            heightMode: "relativeToStartPoint",
            maxBatteryMinutes: 25,
          },
          waypoints: [
            {
              index: 0,
              name: "WP1",
              latitude: 41.258,
              longitude: 0.931,
              height: 30,
              speed: 8,
              gimbalPitchAngle: -30,
              useGlobalHeadingParam: true,
              headingMode: "followWayline",
              actions: [],
            },
            {
              index: 1,
              name: "WP2",
              latitude: 41.259,
              longitude: 0.933,
              height: 35,
              speed: 8,
              gimbalPitchAngle: -30,
              useGlobalHeadingParam: true,
              headingMode: "followWayline",
              actions: [],
            },
          ],
          pois: [],
        },
      });
    }
  });

  test("matches the baseline screenshot", async ({ page }) => {
    await blockMapboxNetwork(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Moje trasy" }).click();

    await expect(page.getByText(FIXED_MISSION_NAMES[0])).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(FIXED_MISSION_NAMES[1])).toBeVisible();

    await expect(page).toHaveScreenshot("mission-list.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
