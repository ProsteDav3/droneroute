import { test, expect } from "@playwright/test";
import {
  blockMapboxNetwork,
  loginViaApi,
  SAMPLE_WAYPOINTS,
} from "../helpers.js";

// No storageState here on purpose — the shared-mission view is intentionally
// public (that's the whole point of a share link), so this spec verifies it
// renders for a fully anonymous visitor.
//
// Sharing itself is a cloud-mode-only feature in the UI (see RoutesPage.tsx's
// `!selfHosted &&` guard on the Share button), and this suite runs against a
// self-hosted backend so it can sign in with a plain email/password instead
// of needing a real Google OAuth client. The share is therefore created via
// the same REST API the Share button itself calls, then the resulting
// read-only page is exercised exactly as a recipient would see it.
test.describe("Shared mission read-only view", () => {
  test("renders a shared mission's name, stats, and waypoint count for an anonymous visitor", async ({
    page,
    request,
    baseURL,
  }) => {
    await blockMapboxNetwork(page);

    const token = await loginViaApi(request, baseURL!);
    const missionName = `E2E shared mission ${Date.now()}`;

    const createRes = await request.post(`${baseURL}/api/missions`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: missionName,
        config: {
          droneEnumValue: 91,
          droneSubEnumValue: 1,
          autoFlightSpeed: 8,
          heightMode: "relativeToStartPoint",
          maxBatteryMinutes: 25,
        },
        waypoints: SAMPLE_WAYPOINTS.map((wp, index) => ({
          index,
          name: `WP${index + 1}`,
          latitude: wp.latitude,
          longitude: wp.longitude,
          height: wp.height,
          speed: 8,
          gimbalPitchAngle: -30,
          useGlobalHeadingParam: true,
          headingMode: "followWayline",
          actions: [],
        })),
        pois: [],
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { id: missionId } = await createRes.json();

    const shareRes = await request.post(
      `${baseURL}/api/missions/${missionId}/share`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(shareRes.ok()).toBeTruthy();
    const { shareToken } = await shareRes.json();
    expect(shareToken).toBeTruthy();

    await page.goto(`/shared/${shareToken}`);

    await expect(page.getByText(missionName)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Sdílená trasa")).toBeVisible();

    // Waypoint count stat card — scoped to the card containing the "Body
    // trasy" label (not a bare "3" text match) so this doesn't accidentally
    // match unrelated "3"s elsewhere on the page.
    const waypointsLabel = page.getByText("Body trasy", { exact: true });
    await expect(waypointsLabel).toBeVisible();
    await expect(waypointsLabel.locator("xpath=..")).toContainText("3");

    await expect(
      page.getByRole("button", { name: "Otevřít v editoru" }),
    ).toBeVisible();
  });

  test("shows a not-found state for an unknown share token", async ({
    page,
  }) => {
    await blockMapboxNetwork(page);
    await page.goto("/shared/this-token-does-not-exist");
    await expect(page.getByText("Trasa nenalezena")).toBeVisible({
      timeout: 20_000,
    });
  });
});
