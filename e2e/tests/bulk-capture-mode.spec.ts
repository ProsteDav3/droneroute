import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { blockMapboxNetwork, dismissWelcomeDialogOnLoad } from "../helpers.js";
import { STORAGE_STATE_PATH } from "../global-setup.js";

test.use({ storageState: STORAGE_STATE_PATH });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A real 72-point orbit exported from DJI Pilot as a video mission: recording
// starts on the first waypoint and stops on the last.
const VIDEO_KMZ = path.resolve(__dirname, "../../Test.kmz");

test("an imported KMZ can be switched between video and photo from the bulk editor", async ({
  page,
}) => {
  await blockMapboxNetwork(page);
  await dismissWelcomeDialogOnLoad(page);
  await page.goto("/");
  await expect(page.getByPlaceholder("Název mise")).toBeVisible({
    timeout: 20_000,
  });

  await page
    .locator('input[type="file"][accept=".kmz"]')
    .setInputFiles(VIDEO_KMZ);
  await expect(page.getByText(/^Body trasy \(\d+\)$/)).toHaveText(
    "Body trasy (72)",
    { timeout: 10_000 },
  );

  // Ctrl+A only reaches the editor when focus isn't in a text field. Not a
  // map click: the editor opens in add-waypoint mode, so that would add a 73rd.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByText("Vybráno: 72")).toBeVisible();
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
