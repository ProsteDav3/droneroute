import { chromium, type FullConfig } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  TEST_USER,
  blockMapboxNetwork,
  dismissWelcomeDialogOnLoad,
} from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Shared authenticated browser storage state, reused by every spec that doesn't specifically test the sign-in flow itself. */
export const STORAGE_STATE_PATH = path.join(__dirname, ".auth", "user.json");

/**
 * Runs once before the whole suite. Self-hosted registration only ever
 * succeeds once (the first account becomes admin, then registration
 * closes) — so this is the *only* place that signs up. It does so through
 * the real sign-up UI (LoginGate's bootstrap form), which is itself part of
 * the golden path this suite exists to cover; every other spec either
 * reuses the resulting storage state or logs in again with the same
 * credentials (see `login.spec.ts`).
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) {
    throw new Error("global-setup: no baseURL configured");
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await blockMapboxNetwork(context);
  await dismissWelcomeDialogOnLoad(context);
  const page = await context.newPage();

  await page.goto(baseURL);

  const emailInput = page.locator("#gate-email");
  await emailInput.waitFor({ state: "visible", timeout: 20_000 });
  await emailInput.fill(TEST_USER.email);
  await page.locator("#gate-password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Vytvořit účet" }).click();

  // Successful sign-up drops LoginGate and renders the main editor sidebar.
  // NOTE: don't wait on the "SkyRoute" text alone — LoginGate itself shows a
  // "SkyRoute" heading before sign-in completes, so that alone would resolve
  // immediately (a race against the async /auth/register call actually
  // finishing). The mission-name input only exists in the authenticated
  // editor view, so it's an unambiguous signal.
  await page
    .getByPlaceholder("Název mise")
    .waitFor({ state: "visible", timeout: 20_000 });

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await context.storageState({ path: STORAGE_STATE_PATH });
  await browser.close();
}
