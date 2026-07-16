import archiver from "archiver";
import { PassThrough } from "stream";
import type { Mission } from "@droneroute/shared";
import { buildTemplateKml, buildWaylinesWpml } from "../lib/wpml.js";
import { buildMissionSegments } from "./missionSegments.js";

export function generateKmzBuffer(mission: Mission): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();

    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    passthrough.on("end", () => resolve(Buffer.concat(chunks)));
    passthrough.on("error", reject);

    archive.pipe(passthrough);

    // Native DJI Pilot 2 layout: both files nested under wpmz/ (and no res/
    // directory — native exports don't include one). Pilot 2's cloud
    // download path validates this layout strictly; its manual import
    // accepts it too, so this is the single most compatible shape.
    const templateKml = buildTemplateKml(mission);
    archive.append(templateKml, { name: "wpmz/template.kml" });

    const waylinesWpml = buildWaylinesWpml(mission);
    archive.append(waylinesWpml, { name: "wpmz/waylines.wpml" });

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

    (async () => {
      for (const segment of buildMissionSegments(mission)) {
        const segmentBuffer = await generateKmzBuffer(segment);
        archive.append(segmentBuffer, { name: `${segment.name}.kmz` });
      }
      archive.finalize();
    })().catch(reject);
  });
}
