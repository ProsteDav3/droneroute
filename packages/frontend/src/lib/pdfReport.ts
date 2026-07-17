import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { MissionConfig, UnitSystem, Waypoint } from "@droneroute/shared";
import {
  estimateFlightStats,
  estimateWaypointArrivalTimes,
  countCaptureActions,
  formatFlightDuration,
  haversine,
} from "@/lib/flightStats";
import { describeDroneAndPayload } from "@/lib/droneModels";
import { formatDistance, formatHeight } from "@/lib/units";
import { addMapSnapshotToPdf, type MapSnapshot } from "@/lib/pdfSnapshot";
import {
  INTER_REGULAR_TTF_BASE64,
  INTER_BOLD_TTF_BASE64,
} from "@/lib/pdfFonts";

/**
 * Registers the Czech-safe Inter subset and switches the document to it.
 * jsPDF's built-in core fonts (Helvetica etc.) only cover WinAnsi/Latin-1 —
 * without this, every caron/ring character (čďěňřšťůž) silently drops or
 * mis-renders, which is what produced reports reading "Po et bodo trasy"
 * instead of "Počet bodů trasy".
 */
function useInterFont(doc: jsPDF): void {
  doc.addFileToVFS("Inter-Regular.ttf", INTER_REGULAR_TTF_BASE64);
  doc.addFont("Inter-Regular.ttf", "Inter", "normal");
  doc.addFileToVFS("Inter-Bold.ttf", INTER_BOLD_TTF_BASE64);
  doc.addFont("Inter-Bold.ttf", "Inter", "bold");
  doc.setFont("Inter", "normal");
}

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
  useInterFont(doc);
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
  const pageHeight = doc.internal.pageSize.getHeight();
  const logoX = pageWidth - 24;
  drawSkyRouteLogo(doc, logoX, 15, 12);
  doc.setFont("Inter", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0, 148, 196);
  doc.text("SkyRoute", logoX, 25, { align: "center" });
  doc.setFont("Inter", "normal");
  doc.setTextColor(0);

  doc.setFontSize(18);
  doc.text("Letový report", 14, 18);
  doc.setFontSize(12);
  doc.text(missionName || "Bez názvu", 14, 26);
  doc.setFontSize(9);
  doc.setTextColor(120);
  const now = new Date();
  const generatedAt = `${now.toLocaleDateString("cs-CZ")} ${now.toLocaleTimeString(
    "cs-CZ",
    { hour: "2-digit", minute: "2-digit" },
  )}`;
  doc.text(`Vygenerováno ${generatedAt}`, 14, 32);
  doc.setTextColor(0);

  const overviewRows: [string, string][] = [
    ["Dron", payloadLabel ? `${droneLabel} (${payloadLabel})` : droneLabel],
    ["Počet bodů trasy", String(waypoints.length)],
    ["Vzdálenost", formatDistance(distanceM, unitSystem)],
    ["Odhadovaný čas letu", formatFlightDuration(timeS)],
    [
      "Rozsah výšek letu (min–max)",
      `${formatHeight(minAltitude, unitSystem)} – ${formatHeight(maxAltitude, unitSystem)}`,
    ],
  ];
  // Photo and video are mutually exclusive in the common case (a template's
  // capture mode is one or the other) — only show a row for what's actually
  // in the mission, and a lone video action reads as "Video záznam", not a
  // count of one, since a mission normally has exactly one continuous
  // recording rather than several discrete ones like photos.
  if (photoCount > 0) {
    overviewRows.push(["Počet fotek", String(photoCount)]);
  }
  if (videoCount === 1) {
    overviewRows.push(["Záznam", "Video záznam"]);
  } else if (videoCount > 1) {
    overviewRows.push(["Video záznamy", String(videoCount)]);
  }

  autoTable(doc, {
    startY: 38,
    theme: "plain",
    styles: { fontSize: 10, font: "Inter" },
    body: overviewRows,
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 } },
  });

  const afterOverviewY = getLastAutoTableY(doc) + 10;

  if (mapSnapshot) {
    addMapSnapshotToPdf(
      doc,
      mapSnapshot,
      14,
      afterOverviewY,
      pageWidth - 28,
      pageHeight - afterOverviewY - 20,
      unitSystem,
    );
  }

  // Waypoint coordinates get their own page — the overview page is already
  // dominated by the (now much larger) map, and the table needs room for
  // per-segment distance/time columns without cramping the coordinates
  // themselves back into unreadable, truncated-looking cells.
  doc.addPage();
  doc.setFont("Inter", "bold");
  doc.setFontSize(14);
  doc.text("Souřadnice bodů trasy", 14, 18);
  doc.setFont("Inter", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    "Čísla v prvním sloupci odpovídají číslům bodů trasy na mapě výše.",
    14,
    25,
  );
  doc.setTextColor(0);

  const arrivalTimesS = estimateWaypointArrivalTimes(
    waypoints,
    config.autoFlightSpeed,
  );

  const rows = waypoints.slice(0, MAX_WAYPOINT_ROWS).map((wp, i) => {
    const prev = waypoints[i - 1];
    const segmentDistanceM = prev
      ? haversine(prev.latitude, prev.longitude, wp.latitude, wp.longitude)
      : null;
    const segmentTimeS = i > 0 ? arrivalTimesS[i] - arrivalTimesS[i - 1] : null;
    return [
      String(i + 1),
      wp.latitude.toFixed(6),
      wp.longitude.toFixed(6),
      formatHeight(wp.height, unitSystem),
      segmentDistanceM === null
        ? "—"
        : formatDistance(segmentDistanceM, unitSystem),
      segmentTimeS === null ? "—" : formatFlightDuration(segmentTimeS),
      describeActions(wp),
    ];
  });

  autoTable(doc, {
    startY: 30,
    head: [
      [
        "#",
        "Lat",
        "Lng",
        "Výška",
        "Vzdál. od předch.",
        "Čas od předch.",
        "Akce",
      ],
    ],
    body: rows,
    styles: { fontSize: 8, font: "Inter" },
    headStyles: { fillColor: [0, 120, 160], font: "Inter", fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 24 },
      2: { cellWidth: 24 },
    },
  });

  if (waypoints.length > MAX_WAYPOINT_ROWS) {
    const finalY = getLastAutoTableY(doc);
    doc.setFont("Inter", "normal");
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
