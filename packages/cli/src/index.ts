#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { program } from "commander";
import chalk from "chalk";
import { detectDevices, selectDevice } from "./device.js";
import { uploadKmz } from "./upload.js";
import { isAdbAvailable } from "./adb.js";
import { fileURLToPath } from "node:url";
import { resolveServer, resolveToken } from "./config.js";
import { parseKmzToMissionJson } from "./kmzParser.js";
import {
  uploadMissionToCloud,
  ensureToken,
  CloudUploadError,
} from "./cloudUpload.js";
import { runInteractiveLogin, LoginError } from "./login.js";
import { DEFAULT_SERVER_URL } from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8"),
);

interface UploadOptions {
  cloud?: boolean;
  server?: string;
  token?: string;
}

async function runCloudUpload(
  kmzPath: string,
  opts: UploadOptions,
): Promise<void> {
  const server = resolveServer(opts.server);

  let token: string;
  try {
    token = ensureToken(resolveToken(opts.token));
  } catch (err) {
    const message = err instanceof CloudUploadError ? err.message : String(err);
    console.error(chalk.red(`\n${message}`));
    process.exit(1);
  }

  console.log(chalk.dim(`Parsing ${path.basename(kmzPath)}...`));

  let mission;
  try {
    const buffer = fs.readFileSync(kmzPath);
    mission = await parseKmzToMissionJson(buffer);
  } catch (err: any) {
    console.error(chalk.red(`\nCould not parse KMZ file: ${err.message}`));
    process.exit(1);
  }

  if (mission.waypoints.length < 2) {
    console.error(
      chalk.red("\nMission needs at least 2 waypoints to upload to DJI Cloud."),
    );
    process.exit(1);
  }

  const name = path.basename(kmzPath, path.extname(kmzPath));

  console.log(chalk.dim(`Uploading to ${server}...`));

  try {
    const result = await uploadMissionToCloud(server, token, {
      name,
      config: mission.config,
      waypoints: mission.waypoints,
      pois: mission.pois,
    });

    console.log(chalk.green("\n✓ Mission uploaded to DJI Cloud successfully"));
    console.log(chalk.dim(`  Wayline name: ${result.waylineName}`));
    console.log(
      chalk.dim(
        "\nOpen DJI Pilot 2's Cloud tab on the remote controller to find it.",
      ),
    );
  } catch (err) {
    const message = err instanceof CloudUploadError ? err.message : String(err);
    console.error(chalk.red(`\nCloud upload failed: ${message}`));
    process.exit(1);
  }
}

async function runAdbUpload(kmzPath: string): Promise<void> {
  // ── Detect controllers ──────────────────────────────────────────
  console.log(chalk.dim("Searching for DJI controllers..."));

  const devices = detectDevices();

  if (devices.length === 0) {
    const hasAdb = isAdbAvailable();

    console.error(chalk.red("\nNo DJI controllers found.\n"));
    console.error(chalk.dim("Troubleshooting:"));
    console.error(
      chalk.dim("  • Connect the controller via USB and power it on"),
    );

    if (!hasAdb) {
      console.error(chalk.dim("  • Install adb for USB detection:"));
      console.error(
        chalk.dim("      macOS:   brew install android-platform-tools"),
      );
      console.error(chalk.dim("      Linux:   apt install adb"));
      console.error(
        chalk.dim("      Windows: included with Android SDK platform-tools"),
      );
    } else {
      console.error(chalk.dim("  • Enable USB debugging on the controller"));
      console.error(
        chalk.dim("  • Check that the USB cable supports data transfer"),
      );
    }

    console.error(chalk.dim("  • Or insert the controller's SD card directly"));
    console.error(
      chalk.dim("  • Or use --cloud to upload straight to DJI Cloud instead"),
    );
    process.exit(1);
  }

  // ── Select device ───────────────────────────────────────────────
  const device = await selectDevice(devices);

  console.log(chalk.dim(`\nUsing ${device.label}`));

  // ── Upload ──────────────────────────────────────────────────────
  try {
    console.log(chalk.dim(`Uploading ${path.basename(kmzPath)}...`));

    const result = uploadKmz(device, kmzPath);

    console.log(chalk.green("\n✓ Mission uploaded successfully"));
    console.log(chalk.dim(`  Uploaded to: ${result.remotePath}`));

    if (device.appKind === "pilot2") {
      console.log(
        chalk.dim(
          "\nDJI Pilot 2 placement is best-effort (unconfirmed on real",
        ),
      );
      console.log(
        chalk.dim(
          "hardware) — open Pilot 2's route/mission import screen and look",
        ),
      );
      console.log(chalk.dim("for the file, or import it manually if not."));
    } else {
      console.log(
        chalk.dim("\nOpen DJI Fly on the controller and look for the new"),
      );
      console.log(chalk.dim("mission in the waypoint list."));
    }
  } catch (err: any) {
    console.error(chalk.red(`\nUpload failed: ${err.message}`));
    console.error(
      chalk.dim("Check that the controller is connected and try again."),
    );
    process.exit(1);
  }
}

program
  .name("droneroute")
  .description(
    "Upload DJI waypoint mission KMZ files to RC controllers via USB, or to DJI Cloud",
  )
  .version(pkg.version)
  .argument("<file>", "path to a .kmz mission file")
  .option(
    "--cloud",
    "upload to a SkyRoute server's DJI Cloud platform instead of via ADB/USB",
  )
  .option(
    "--server <url>",
    `SkyRoute server URL for --cloud (default: ${DEFAULT_SERVER_URL}, or $DRONEROUTE_SERVER, or the value saved by "droneroute login")`,
  )
  .option(
    "--token <jwt>",
    'auth token for --cloud (default: $DRONEROUTE_TOKEN, or the value saved by "droneroute login")',
  )
  .action(async (file: string, opts: UploadOptions) => {
    const kmzPath = path.resolve(file);

    if (!fs.existsSync(kmzPath)) {
      console.error(chalk.red(`Error: file "${file}" not found`));
      process.exit(1);
    }

    if (!file.toLowerCase().endsWith(".kmz")) {
      const ext = path.extname(file) || "(none)";
      console.error(chalk.red(`Error: expected a .kmz file, got "${ext}"`));
      process.exit(1);
    }

    if (opts.cloud) {
      await runCloudUpload(kmzPath, opts);
    } else {
      await runAdbUpload(kmzPath);
    }
  });

program
  .command("login")
  .description(
    "log in to a SkyRoute server and cache the auth token for --cloud uploads",
  )
  .option(
    "--server <url>",
    `SkyRoute server URL (default: ${DEFAULT_SERVER_URL})`,
  )
  .action(async (opts: { server?: string }) => {
    try {
      await runInteractiveLogin(resolveServer(opts.server), opts.server);
      console.log(
        chalk.green(
          "\n✓ Logged in — token cached in ~/.droneroute/config.json",
        ),
      );
    } catch (err) {
      const message = err instanceof LoginError ? err.message : String(err);
      console.error(chalk.red(`\nLogin failed: ${message}`));
      process.exit(1);
    }
  });

program.parse();
