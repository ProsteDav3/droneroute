import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { MissionConfig, UnitSystem, Waypoint } from "@droneroute/shared";
import {
  estimateFlightStats,
  countCaptureActions,
  formatFlightDuration,
} from "@/lib/flightStats";
import { describeDroneAndPayload } from "@/lib/droneModels";
import { formatDistance, formatHeight } from "@/lib/units";
import { addMapSnapshotToPdf, type MapSnapshot } from "@/lib/pdfSnapshot";

export interface MissionReportInput {
  missionName: string;
  config: MissionConfig;
  waypoints: Waypoint[];
  unitSystem: UnitSystem;
  /** Current map view, captured via lib/pdfSnapshot.ts — omitted entirely if unavailable (e.g. the map hasn't finished loading yet). */
  mapSnapshot?: MapSnapshot;
}

/** Cap the per-waypoint table to keep the report a reasonable length for very dense surveys (hundreds/thousands of points). */
const MAX_WAYPOINT_ROWS = 200;

/**
 * Draws the SkyRoute mark (the same drone icon as `public/skyroute-icon.svg`)
 * directly with jsPDF's vector primitives, so the report is recognizably a
 * SkyRoute document without needing to rasterize/embed an image asset —
 * `x`/`y` is the icon's center, `size` its width/height in mm.
 */
function drawSkyRouteLogo(
  doc: jsPDF,
  x: number,
  y: number,
  size: number,
): void {
  const s = size / 32; // scale factor from the SVG's 32x32 viewBox
  doc.setDrawColor(0, 194, 255);
  doc.setFillColor(0, 194, 255);

  // Body (center square)
  doc.roundedRect(x - 2.5 * s, y - 2.5 * s, 5 * s, 5 * s, 1 * s, 1 * s, "F");

  // Arms (X pattern) + rotor rings, one corner at a time
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  doc.setLineWidth(0.5 * s);
  for (const [dx, dy] of corners) {
    const armEndX = x + dx * 4.5 * s;
    const armEndY = y + dy * 4.5 * s;
    const bodyX = x + dx * 2.5 * s;
    const bodyY = y + dy * 2.5 * s;
    doc.line(bodyX, bodyY, armEndX, armEndY);
    doc.circle(armEndX, armEndY, 2.2 * s, "S");
  }
}

/** `jspdf-autotable` augments `jsPDF` with `lastAutoTable` at runtime, with no official type for it. */
function getLastAutoTableY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY;
}

function describeActions(wp: Waypoint): string {
  if (wp.actions.length === 0) return "";
  const labels: Record<string, string> = {
    takePhoto: "Foto",
    startRecord: "Start videa",
    stopRecord: "Stop videa",
    hover: "Hover",
    rotateYaw: "Otočení",
    gimbalRotate: "Gimbal",
    zoom: "Zoom",
    focus: "Zaostření",
  };
  return wp.actions.map((a) => labels[a.actionType] ?? a.actionType).join(", ");
}

/** Build a client-facing PDF summary of a planned mission: overview, drone/camera, flight stats, and a waypoint table. */
export function generateMissionReportPdf({
  missionName,
  config,
  waypoints,
  unitSystem,
  mapSnapshot,
}: MissionReportInput): jsPDF {
  const doc = new jsPDF();
  const { droneLabel, payloadLabel } = describeDroneAndPayload(config);
  const { distanceM, timeS } = estimateFlightStats(
    waypoints,
    config.autoFlightSpeed,
  );
  const { photoCount, videoCount } = countCaptureActions(waypoints);
  const altitudes = waypoints.map((wp) => wp.height);
  const minAltitude = altitudes.length ? Math.min(...altitudes) : 0;
  const maxAltitude = altitudes.length ? Math.max(...altitudes) : 0;

  const pageWidth = doc.internal.pageSize.getWidth();
  const logoX = pageWidth - 20;
  drawSkyRouteLogo(doc, logoX, 13, 8);
  doc.setFontSize(9);
  doc.setTextColor(0, 148, 196);
  doc.text("SkyRoute", logoX, 21, { align: "center" });
  doc.setTextColor(0);

  doc.setFontSize(18);
  doc.text("Letový report", 14, 18);
  doc.setFontSize(12);
  doc.text(missionName || "Bez názvu", 14, 26);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Vygenerováno ${new Date().toLocaleDateString("cs-CZ")}`, 14, 32);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 38,
    theme: "plain",
    styles: { fontSize: 10 },
    body: [
      ["Dron", payloadLabel ? `${droneLabel} (${payloadLabel})` : droneLabel],
      ["Počet bodů trasy", String(waypoints.length)],
      ["Vzdálenost", formatDistance(distanceM, unitSystem)],
      ["Odhadovaný čas letu", formatFlightDuration(timeS)],
      [
        "Rozsah výšek",
        `${formatHeight(minAltitude, unitSystem)} – ${formatHeight(maxAltitude, unitSystem)}`,
      ],
      ["Počet fotek", String(photoCount)],
      ["Video záznamů", String(videoCount)],
    ],
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
  });

  let afterOverviewY = getLastAutoTableY(doc) + 10;

  if (mapSnapshot) {
    afterOverviewY =
      addMapSnapshotToPdf(
        doc,
        mapSnapshot,
        14,
        afterOverviewY,
        pageWidth - 28,
        90,
      ) + 10;
  }

  const rows = waypoints
    .slice(0, MAX_WAYPOINT_ROWS)
    .map((wp, i) => [
      String(i + 1),
      wp.latitude.toFixed(6),
      wp.longitude.toFixed(6),
      formatHeight(wp.height, unitSystem),
      describeActions(wp),
    ]);

  autoTable(doc, {
    startY: afterOverviewY,
    head: [["#", "Lat", "Lng", "Výška", "Akce"]],
    body: rows,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [0, 120, 160] },
  });

  if (waypoints.length > MAX_WAYPOINT_ROWS) {
    const finalY = getLastAutoTableY(doc);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `... a dalších ${waypoints.length - MAX_WAYPOINT_ROWS} bodů trasy (report zobrazuje prvních ${MAX_WAYPOINT_ROWS})`,
      14,
      finalY + 6,
    );
  }

  return doc;
}
