import archiver from "archiver";
import { PassThrough } from "stream";
import type { Mission } from "@droneroute/shared";
import { buildTemplateKml, buildWaylinesWpml } from "../lib/wpml.js";

export function generateKmzBuffer(mission: Mission): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();

    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    passthrough.on("end", () => resolve(Buffer.concat(chunks)));
    passthrough.on("error", reject);

    archive.pipe(passthrough);

    // Add template.kml
    const templateKml = buildTemplateKml(mission);
    archive.append(templateKml, { name: "template.kml" });

    // Add waylines.wpml
    const waylinesWpml = buildWaylinesWpml(mission);
    archive.append(waylinesWpml, { name: "waylines.wpml" });

    // Add empty res/ directory
    archive.append("", { name: "res/" });

    archive.finalize();
  });
}

/**
 * Splits a mission's waypoints into consecutive one-leg missions
 * (waypoint 1→2, 2→3, ... N-1→N) and packages every resulting .kmz into a
 * single downloadable zip. Each leg keeps the parent mission's config and
 * POIs (e.g. a shared `towardPOI` target), so heading/gimbal targeting stays
 * identical across every leg regardless of which slice of the original path
 * it covers.
 */
export function generateMissionSegmentsZip(mission: Mission): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();

    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    passthrough.on("end", () => resolve(Buffer.concat(chunks)));
    passthrough.on("error", reject);

    archive.pipe(passthrough);

    const segmentCount = mission.waypoints.length - 1;
    const pad = String(segmentCount).length;
    const safeName = mission.name.replace(/[^a-zA-Z0-9_-]/g, "_");

    (async () => {
      for (let i = 0; i < segmentCount; i++) {
        const segmentName = `${safeName}-seg-${String(i + 1).padStart(pad, "0")}-of-${segmentCount}`;
        const segmentMission: Mission = {
          ...mission,
          name: segmentName,
          waypoints: [
            { ...mission.waypoints[i], index: 0 },
            { ...mission.waypoints[i + 1], index: 1 },
          ],
        };
        const segmentBuffer = await generateKmzBuffer(segmentMission);
        archive.append(segmentBuffer, { name: `${segmentName}.kmz` });
      }
      archive.finalize();
    })().catch(reject);
  });
}
