/**
 * Server-side validation for the compliance-tooling payloads: flight logbook
 * entries, SORA-lite risk assessments, and permit/authorization records.
 * Same rationale as `missionValidation.ts` — client-side checks are UX only,
 * every payload that gets persisted is validated here too.
 */

const MAX_TEXT_LEN = 2000;
const MAX_SHORT_TEXT_LEN = 300;
const MAX_MITIGATIONS = 20;

const GROUND_RISK_CLASSES = ["low", "medium", "high"] as const;
const AIR_RISK_CLASSES = ["low", "medium", "high"] as const;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v: unknown, maxLen: number): v is string {
  return typeof v === "string" && v.trim().length >= 1 && v.length <= maxLen;
}

function isOptionalString(v: unknown, maxLen: number): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.length <= maxLen)
  );
}

function isValidIsoDate(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(v) &&
    !Number.isNaN(Date.parse(v))
  );
}

// ── Flight log ───────────────────────────────────────────

export interface FlightLogPayload {
  missionId?: unknown;
  flownAt?: unknown;
  durationMinutes?: unknown;
  notes?: unknown;
}

export function validateFlightLogCreate(body: FlightLogPayload): string | null {
  if (body.missionId !== undefined && body.missionId !== null) {
    if (!isNonEmptyString(body.missionId, MAX_SHORT_TEXT_LEN)) {
      return "neplatné ID mise";
    }
  }
  if (!isValidIsoDate(body.flownAt)) return "neplatné datum letu";
  if (
    !isFiniteNumber(body.durationMinutes) ||
    body.durationMinutes < 0 ||
    body.durationMinutes > 24 * 60
  ) {
    return "neplatná doba letu";
  }
  if (!isOptionalString(body.notes, MAX_TEXT_LEN)) return "neplatná poznámka";
  return null;
}

// ── Risk assessment ──────────────────────────────────────

export interface RiskAssessmentPayload {
  groundRiskClass?: unknown;
  airRiskClass?: unknown;
  mitigations?: unknown;
}

export function validateRiskAssessment(
  body: RiskAssessmentPayload,
): string | null {
  if (
    typeof body.groundRiskClass !== "string" ||
    !GROUND_RISK_CLASSES.includes(body.groundRiskClass as any)
  ) {
    return "neplatná třída pozemního rizika";
  }
  if (
    typeof body.airRiskClass !== "string" ||
    !AIR_RISK_CLASSES.includes(body.airRiskClass as any)
  ) {
    return "neplatná třída vzdušného rizika";
  }
  if (body.mitigations !== undefined) {
    if (!Array.isArray(body.mitigations)) return "neplatná opatření";
    if (body.mitigations.length > MAX_MITIGATIONS)
      return "příliš mnoho opatření";
    for (const m of body.mitigations) {
      if (typeof m !== "string" || m.length > MAX_SHORT_TEXT_LEN) {
        return "neplatné opatření";
      }
    }
  }
  return null;
}

// ── Permit ───────────────────────────────────────────────

export interface PermitPayload {
  missionId?: unknown;
  description?: unknown;
  referenceOrUrl?: unknown;
  expiryDate?: unknown;
  issuedBy?: unknown;
}

export function validatePermitCreate(body: PermitPayload): string | null {
  if (!isNonEmptyString(body.missionId, MAX_SHORT_TEXT_LEN)) {
    return "neplatné ID mise";
  }
  if (!isNonEmptyString(body.description, MAX_TEXT_LEN)) {
    return "neplatný popis povolení";
  }
  if (!isOptionalString(body.referenceOrUrl, MAX_TEXT_LEN)) {
    return "neplatný odkaz/referenční číslo";
  }
  if (
    body.expiryDate !== undefined &&
    body.expiryDate !== null &&
    body.expiryDate !== "" &&
    !isValidIsoDate(body.expiryDate)
  ) {
    return "neplatné datum expirace";
  }
  if (!isOptionalString(body.issuedBy, MAX_SHORT_TEXT_LEN)) {
    return "neplatný vydavatel";
  }
  return null;
}

export { GROUND_RISK_CLASSES, AIR_RISK_CLASSES };
