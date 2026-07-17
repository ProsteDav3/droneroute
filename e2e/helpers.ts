import type { Page, BrowserContext, APIRequestContext } from "@playwright/test";

/**
 * Self-hosted registration is a one-time bootstrap: the very first account
 * created on a fresh database becomes the admin, and registration then
 * closes forever. `global-setup.ts` performs that one bootstrap sign-up
 * through the real UI; every other spec authenticates as this same account
 * (either via the saved storage state, or by logging in again).
 */
export const TEST_USER = {
  email: "e2e-founder@example.test",
  password: "e2e-test-password-not-for-prod",
};

/** Matches AGENTS.md's standard screenshot map coordinates. */
export const TEST_MAP_VIEW = {
  latitude: 41.25797725781744,
  longitude: 0.9322907667035154,
};

/**
 * Mapbox GL JS needs *some* access token to render the map at all (see
 * MapView.tsx's `if (!mapboxToken)` guard) — it doesn't need to be a real,
 * valid token since `blockMapboxNetwork` below stops it from ever being used
 * against the real Mapbox API. It DOES need to be JWT-shaped though:
 * mapbox-gl-js parses the token client-side (`header.payload.signature`,
 * splitting on ".", base64-decoding and JSON-parsing the payload) purely to
 * read a couple of optional fields — a plain non-JWT string makes that
 * parser throw an uncaught "Invalid token" error that crashes the whole
 * React tree. Must match the `MAPBOX_TOKEN` env var the backend is started
 * with (see playwright.config.ts) since the frontend reads it back from
 * `/api/config`.
 */
export const FAKE_MAPBOX_TOKEN =
  "pk.eyJ1IjoiZTJlLXRlc3QtdXNlciJ9.fakesignature123";

const EMPTY_MAPBOX_STYLE = {
  version: 8,
  name: "Empty (E2E stub)",
  sources: {},
  layers: [],
};

/**
 * Keeps the whole suite fully offline and deterministic: Mapbox GL would
 * otherwise fetch its style/sprite/glyphs/tiles from the real Mapbox API on
 * every test. Style requests are fulfilled with a minimal valid (empty)
 * style so the map still fires its `load` event and initializes a real
 * WebGL canvas — pixel↔lnglat conversion (and therefore click-to-add
 * waypoint/POI) is computed from the map's transform, which is set up from
 * `initialViewState` independently of whether the style/tiles ever load, so
 * this doesn't affect the click-driven flows under test. Every other
 * mapbox.com request (fonts, sprites, raster/vector tiles, telemetry) is
 * just aborted — the suite never asserts on rendered tile imagery.
 *
 * Playwright matches routes last-registered-first, so the more specific
 * style-fulfilling route is registered *after* the catch-all abort route.
 */
export async function blockMapboxNetwork(
  target: Page | BrowserContext,
): Promise<void> {
  await target.route(/mapbox\.com/, (route) => route.abort());
  await target.route("https://api.mapbox.com/styles/v1/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY_MAPBOX_STYLE),
    }),
  );
}

/** Dismisses the first-run welcome dialog so it never blocks a click. */
export async function dismissWelcomeDialogOnLoad(
  target: Page | BrowserContext,
): Promise<void> {
  await target.addInitScript(() => {
    window.localStorage.setItem("droneroute_welcome_dismissed", "1");
  });
}

/**
 * Clicks on the map at an offset (in CSS pixels) from its center. Waypoints
 * and POIs are placed via absolute pixel clicks translated to lng/lat by
 * Mapbox GL itself, so exact map-panel coordinates don't matter for these
 * tests — only that clicks land inside the map canvas and are spread out
 * enough to produce distinct waypoints.
 */
export async function clickOnMap(
  page: Page,
  offsetX: number,
  offsetY: number,
): Promise<void> {
  const map = page.locator(".mapboxgl-canvas").first();
  const box = await map.boundingBox();
  if (!box) throw new Error("Map canvas not found or not visible");
  await page.mouse.click(
    box.x + box.width / 2 + offsetX,
    box.y + box.height / 2 + offsetY,
  );
}

/** Logs in as `TEST_USER` through the real API (no browser needed) — used to seed/clean up data via REST before a UI-driven assertion. */
export async function loginViaApi(
  request: APIRequestContext,
  baseURL: string,
): Promise<string> {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { email: TEST_USER.email, password: TEST_USER.password },
  });
  if (!res.ok()) {
    throw new Error(`loginViaApi failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return body.token as string;
}

export const SAMPLE_WAYPOINTS = [
  { latitude: 41.2582, longitude: 0.9315, height: 30 },
  { latitude: 41.2585, longitude: 0.933, height: 35 },
  { latitude: 41.257, longitude: 0.9335, height: 30 },
];
