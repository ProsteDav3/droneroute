import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ObstacleWarning, AirspaceWarning } from "@/lib/geo";
import {
  RISK_CLASS_LABELS,
  WEATHER_STATUS_LABELS,
  mitigationLabel,
  type RiskClass,
  type WeatherGoNoGo,
} from "@/lib/preflightChecklist";
import { formatFlightDuration } from "@/lib/flightStats";

export interface PreflightRiskAssessment {
  groundRiskClass: RiskClass;
  airRiskClass: RiskClass;
  mitigations: string[];
  assessedAt: string;
}

export interface PreflightPermit {
  description: string;
  expiryDate: string | null;
  referenceOrUrl: string | null;
}

export interface PreflightChecklistInput {
  missionName: string;
  obstacleWarnings: ObstacleWarning[];
  airspaceWarnings: AirspaceWarning[];
  batteryExceeded: boolean;
  flightTimeS: number;
  maxBatteryMinutes: number;
  weather: WeatherGoNoGo;
  riskAssessment: PreflightRiskAssessment | null;
  permits: PreflightPermit[];
}

/** `jspdf-autotable` augments `jsPDF` with `lastAutoTable` at runtime, with no official type for it. */
function getLastAutoTableY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY;
}

function sectionHeading(doc: jsPDF, text: string, y: number): number {
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(text, 14, y);
  return y + 6;
}

/**
 * Build a preflight checklist PDF: airspace conflicts, mission validation
 * warnings, weather go/no-go, and a SORA-lite risk/permit status summary.
 * Follows the same jsPDF conventions (fonts, margins, autoTable styling) as
 * `pdfReport.ts`'s client-facing mission report.
 */
export function generatePreflightChecklistPdf({
  missionName,
  obstacleWarnings,
  airspaceWarnings,
  batteryExceeded,
  flightTimeS,
  maxBatteryMinutes,
  weather,
  riskAssessment,
  permits,
}: PreflightChecklistInput): jsPDF {
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text("Předletová kontrola", 14, 18);
  doc.setFontSize(12);
  doc.text(missionName || "Bez názvu", 14, 26);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Vygenerováno ${new Date().toLocaleDateString("cs-CZ")}`, 14, 32);
  doc.setTextColor(0);

  let y = 40;

  // ── Mission validation warnings ──────────────────────────
  y = sectionHeading(doc, "Kontrola mise", y);
  const validationRows: string[][] = [];
  if (batteryExceeded) {
    validationRows.push([
      `Doba letu (${formatFlightDuration(flightTimeS)}) přesahuje kapacitu baterie (${maxBatteryMinutes} min)`,
    ]);
  }
  if (obstacleWarnings.length > 0) {
    validationRows.push([
      `${obstacleWarnings.length} upozornění na překážky na trase letu`,
    ]);
  }
  if (validationRows.length === 0) {
    validationRows.push(["Žádná upozornění"]);
  }
  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 9 },
    body: validationRows,
  });
  y = getLastAutoTableY(doc) + 8;

  // ── Airspace conflicts ────────────────────────────────────
  y = sectionHeading(doc, "Konflikty se vzdušným prostorem", y);
  const airspaceRows =
    airspaceWarnings.length > 0
      ? airspaceWarnings.map((w) => [
          w.zoneName,
          w.severity === "prohibited" ? "Zakázaná" : "Omezená",
          w.type === "inside" ? "Uvnitř zóny" : "Protíná zónu",
          w.altitudeUpper !== undefined ? `${w.altitudeUpper} m AGL` : "—",
        ])
      : [["Žádné zjištěné konflikty", "", "", ""]];
  autoTable(doc, {
    startY: y,
    head:
      airspaceWarnings.length > 0
        ? [["Zóna", "Typ", "Vztah k trase", "Výškový limit"]]
        : undefined,
    body: airspaceRows,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [0, 120, 160] },
  });
  y = getLastAutoTableY(doc) + 8;

  // ── Weather go/no-go ──────────────────────────────────────
  y = sectionHeading(doc, "Počasí", y);
  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 9 },
    body: [
      ["Stav", WEATHER_STATUS_LABELS[weather.status]],
      ["Poznámka", weather.reasons.join("; ")],
    ],
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 30 } },
  });
  y = getLastAutoTableY(doc) + 8;

  // ── SORA-lite risk assessment (placeholder-friendly) ─────
  y = sectionHeading(doc, "Posouzení rizik (zjednodušené, SORA-lite)", y);
  if (riskAssessment) {
    autoTable(doc, {
      startY: y,
      theme: "plain",
      styles: { fontSize: 9 },
      body: [
        ["Pozemní riziko", RISK_CLASS_LABELS[riskAssessment.groundRiskClass]],
        ["Vzdušné riziko", RISK_CLASS_LABELS[riskAssessment.airRiskClass]],
        [
          "Opatření",
          riskAssessment.mitigations.length > 0
            ? riskAssessment.mitigations.map(mitigationLabel).join(", ")
            : "Žádná",
        ],
      ],
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
    });
    y = getLastAutoTableY(doc) + 4;
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(
      "Zjednodušený nástroj k orientaci, nikoli oficiální SORA podání.",
      14,
      y,
    );
    doc.setTextColor(0);
    y += 8;
  } else {
    autoTable(doc, {
      startY: y,
      theme: "plain",
      styles: { fontSize: 9 },
      body: [["Posouzení rizik pro tuto misi dosud nebylo vytvořeno."]],
    });
    y = getLastAutoTableY(doc) + 8;
  }

  // ── Permit / authorization status ────────────────────────
  y = sectionHeading(doc, "Povolení a koordinace", y);
  const permitRows =
    permits.length > 0
      ? permits.map((p) => [
          p.description,
          p.expiryDate ?? "Bez expirace",
          p.referenceOrUrl ?? "—",
        ])
      : [["Pro tuto misi nejsou evidována žádná povolení", "", ""]];
  autoTable(doc, {
    startY: y,
    head: permits.length > 0 ? [["Popis", "Expirace", "Reference"]] : undefined,
    body: permitRows,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [0, 120, 160] },
  });

  return doc;
}
