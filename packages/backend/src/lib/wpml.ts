import type {
  Mission,
  MissionConfig,
  Waypoint,
  WaypointAction,
  PointOfInterest,
} from "@droneroute/shared";

// This module emits DJI WPML 1.0.6 in the exact structure DJI Pilot 2
// (Matrice 4 era) generates natively. That matters because Pilot 2's
// cloud-download path STRICTLY validates wayline files against the native
// format ("Original route file error. Make sure route file is not modified
// by third-party tool.") — unlike manual import, which tolerates older
// WPML. The field set and ordering below were verified against a real
// mission exported from a Pilot 2 RC (M4T) and a converted SkyRoute
// mission that a real RC accepted end-to-end via DJI Cloud API.

const WPML_NS = "http://www.dji.com/wpmz/1.0.6";

// ── XML Helpers ──────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Compute bearing (degrees, 0=N, CW) from point A to point B */
function computeBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360;
}

/** Great-circle distance in meters between two lat/lng points. */
function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function findPoi(
  pois: PointOfInterest[],
  id?: string,
): PointOfInterest | undefined {
  if (!id) return undefined;
  return pois.find((p) => p.id === id);
}

/**
 * waylines.wpml's `executeHeightMode` enum (WGS84 | relativeToStartPoint |
 * realTimeFollowSurface) differs from the template/mission `heightMode`
 * enum. Map conservatively so exported missions keep flying exactly the
 * way they fly today: AGL maps to relativeToStartPoint (matching how the
 * aircraft actually interpreted our 1.0.2 files, which never emitted
 * executeHeightMode at all), NOT to realTimeFollowSurface, which would
 * silently enable terrain following.
 */
function mapExecuteHeightMode(heightMode: MissionConfig["heightMode"]): string {
  switch (heightMode) {
    case "EGM96":
      return "WGS84";
    case "relativeToStartPoint":
    case "aboveGroundLevel":
    default:
      return "relativeToStartPoint";
  }
}

/**
 * Payloads with a thermal sensor save both visual and IR imagery — matches
 * the `imageFormat` a real M4T-era Pilot 2 writes into its own missions
 * ("visable" [sic — DJI's own spelling], "ir"). Keyed by payloadEnumValue,
 * covering every thermal-capable payload in DRONE_MODELS: H20T, M30T,
 * H20N (night camera with dual thermal sensors), M3T, M3TD, H30T,
 * Matrice 4T. PSDK (65534) is intentionally excluded — a generic
 * third-party mount whose capabilities are unknown.
 */
const THERMAL_PAYLOAD_ENUM_VALUES = [43, 53, 61, 67, 81, 83, 89];

function imageFormatFor(payloadEnumValue: number): string {
  return THERMAL_PAYLOAD_ENUM_VALUES.includes(payloadEnumValue)
    ? "visable,ir"
    : "visable";
}

// ── Action XML ───────────────────────────────────────────

function buildActionXml(action: WaypointAction): string {
  let paramsXml = "";

  switch (action.actionType) {
    case "takePhoto": {
      const p = action.params as any;
      paramsXml = `
              <wpml:payloadPositionIndex>${p.payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>
              <wpml:fileSuffix>${escapeXml(p.fileSuffix || "")}</wpml:fileSuffix>${
                p.payloadLensIndex
                  ? `
              <wpml:payloadLensIndex>${escapeXml(p.payloadLensIndex)}</wpml:payloadLensIndex>
              <wpml:useGlobalPayloadLensIndex>0</wpml:useGlobalPayloadLensIndex>`
                  : ""
              }`;
      break;
    }
    case "startRecord":
      paramsXml = `
              <wpml:payloadPositionIndex>${(action.params as any).payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>
              <wpml:fileSuffix>${escapeXml((action.params as any).fileSuffix || "")}</wpml:fileSuffix>`;
      break;
    case "stopRecord":
      paramsXml = `
              <wpml:payloadPositionIndex>${(action.params as any).payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>`;
      break;
    case "gimbalRotate": {
      const p = action.params as any;
      paramsXml = `
              <wpml:gimbalHeadingYawBase>north</wpml:gimbalHeadingYawBase>
              <wpml:gimbalRotateMode>${p.gimbalRotateMode || "absoluteAngle"}</wpml:gimbalRotateMode>
              <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>
              <wpml:gimbalPitchRotateAngle>${p.gimbalPitchRotateAngle ?? 0}</wpml:gimbalPitchRotateAngle>
              <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable>
              <wpml:gimbalRollRotateAngle>${p.gimbalRollRotateAngle ?? 0}</wpml:gimbalRollRotateAngle>
              <wpml:gimbalYawRotateEnable>1</wpml:gimbalYawRotateEnable>
              <wpml:gimbalYawRotateAngle>${p.gimbalYawRotateAngle ?? 0}</wpml:gimbalYawRotateAngle>
              <wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable>
              <wpml:gimbalRotateTime>0</wpml:gimbalRotateTime>
              <wpml:payloadPositionIndex>${p.payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>`;
      break;
    }
    case "gimbalEvenlyRotate": {
      const p = action.params as any;
      paramsXml = `
              <wpml:gimbalPitchRotateAngle>${p.gimbalPitchRotateAngle ?? -45}</wpml:gimbalPitchRotateAngle>
              <wpml:payloadPositionIndex>${p.payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>`;
      break;
    }
    case "rotateYaw": {
      const p = action.params as any;
      paramsXml = `
              <wpml:aircraftHeading>${p.aircraftHeading ?? 0}</wpml:aircraftHeading>
              <wpml:aircraftPathMode>${p.aircraftPathMode || "clockwise"}</wpml:aircraftPathMode>`;
      break;
    }
    case "hover":
      paramsXml = `
              <wpml:hoverTime>${(action.params as any).hoverTime ?? 5}</wpml:hoverTime>`;
      break;
    case "zoom":
      paramsXml = `
              <wpml:focalLength>${(action.params as any).focalLength ?? 24}</wpml:focalLength>`;
      break;
    case "focus": {
      const p = action.params as any;
      paramsXml = `
              <wpml:isPointFocus>${p.isPointFocus ? 1 : 0}</wpml:isPointFocus>
              <wpml:focusX>${p.focusX ?? 0.5}</wpml:focusX>
              <wpml:focusY>${p.focusY ?? 0.5}</wpml:focusY>
              <wpml:isInfiniteFocus>${p.isInfiniteFocus ? 1 : 0}</wpml:isInfiniteFocus>`;
      break;
    }
  }

  return `
          <wpml:action>
            <wpml:actionId>${action.actionId}</wpml:actionId>
            <wpml:actionActuatorFunc>${action.actionType}</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>${paramsXml}
            </wpml:actionActuatorFuncParam>
          </wpml:action>`;
}

function buildActionGroupXml(wp: Waypoint, groupIdOffset: number): string {
  if (wp.actions.length === 0) return "";

  const actionsXml = wp.actions.map(buildActionXml).join("");

  return `
        <wpml:actionGroup>
          <wpml:actionGroupId>${groupIdOffset}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${wp.index}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${wp.index}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
          </wpml:actionTrigger>${actionsXml}
        </wpml:actionGroup>`;
}

// ── Shared blocks ────────────────────────────────────────

/**
 * Identical missionConfig block in both files — 1.0.6 additionally requires
 * `waylineAvoidLimitAreaMode`, placed between droneInfo and payloadInfo
 * exactly where native Pilot 2 puts it.
 */
function buildMissionConfigXml(c: MissionConfig): string {
  return `  <wpml:missionConfig>
    <wpml:flyToWaylineMode>${c.flyToWaylineMode}</wpml:flyToWaylineMode>
    <wpml:finishAction>${c.finishAction}</wpml:finishAction>
    <wpml:exitOnRCLost>${c.exitOnRCLost}</wpml:exitOnRCLost>
    <wpml:executeRCLostAction>${c.executeRCLostAction}</wpml:executeRCLostAction>
    <wpml:takeOffSecurityHeight>${c.takeOffSecurityHeight}</wpml:takeOffSecurityHeight>
    <wpml:globalTransitionalSpeed>${c.globalTransitionalSpeed}</wpml:globalTransitionalSpeed>
    <wpml:droneInfo>
      <wpml:droneEnumValue>${c.droneEnumValue}</wpml:droneEnumValue>
      <wpml:droneSubEnumValue>${c.droneSubEnumValue}</wpml:droneSubEnumValue>
    </wpml:droneInfo>
    <wpml:waylineAvoidLimitAreaMode>0</wpml:waylineAvoidLimitAreaMode>
    <wpml:payloadInfo>
      <wpml:payloadEnumValue>${c.payloadEnumValue}</wpml:payloadEnumValue>
      <wpml:payloadSubEnumValue>${c.payloadSubEnumValue ?? 0}</wpml:payloadSubEnumValue>
      <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
    </wpml:payloadInfo>
  </wpml:missionConfig>`;
}

interface ResolvedHeading {
  mode: string;
  angle: number;
  /** "lat,lng,height" — zeros when the waypoint has no POI target. */
  poiPoint: string;
}

const ZERO_POI_POINT = "0.000000,0.000000,0.000000";

/**
 * Effective per-waypoint heading (globals resolved). 1.0.6 always carries
 * a full waypointHeadingParam per waypoint in waylines.wpml, so every
 * field needs a concrete value even for waypoints on the global default.
 *
 * Returns `null` when the waypoint asks for `towardPOI` but its POI can't
 * be resolved — emitting towardPOI with a zeroed target would aim the
 * aircraft at 0,0 instead of harmlessly falling back, so callers must
 * substitute a safe default (template: omit the override entirely;
 * waylines: fall back to the global mode).
 */
function resolveHeading(
  wp: Waypoint,
  c: MissionConfig,
  pois: PointOfInterest[],
): ResolvedHeading | null {
  const mode = wp.useGlobalHeadingParam
    ? c.globalHeadingMode
    : wp.headingMode || c.globalHeadingMode;
  if (mode === "towardPOI") {
    const poi = findPoi(pois, wp.poiId);
    if (!poi) return null;
    return {
      mode,
      angle: computeBearing(
        wp.latitude,
        wp.longitude,
        poi.latitude,
        poi.longitude,
      ),
      poiPoint: `${poi.latitude},${poi.longitude},${poi.height}`,
    };
  }
  return { mode, angle: wp.headingAngle ?? 0, poiPoint: ZERO_POI_POINT };
}

/**
 * `waypointHeadingAngleEnable` tells the aircraft the angle field is an
 * explicit user setting — native Pilot 2 sets it for the fixed-angle
 * modes and clears it for path/POI-driven modes.
 */
function headingAngleEnable(mode: string): number {
  return mode === "fixed" || mode === "smoothTransition" ? 1 : 0;
}

// ── Template KML ─────────────────────────────────────────

export function buildTemplateKml(mission: Mission): string {
  const c = mission.config;
  const pois = mission.pois || [];
  const now = Date.now();

  const placemarks = mission.waypoints
    .map((wp, i) => {
      const actionGroupXml = buildActionGroupXml(wp, i);

      // Per-waypoint heading override whenever this waypoint opts out of
      // the global heading config — Pilot 2 regenerates its own
      // waylines.wpml from template.kml, so target-tracking modes (Orbit/
      // Turbine/Facade-thermal give each waypoint its own bearing) must be
      // fully described here too, not just in waylines.wpml.
      let headingOverrideXml = "";
      if (!wp.useGlobalHeadingParam && wp.headingMode) {
        const h = resolveHeading(wp, c, pois);
        if (h) {
          headingOverrideXml = `
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>${h.mode}</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>${h.angle}</wpml:waypointHeadingAngle>
          <wpml:waypointPoiPoint>${h.poiPoint}</wpml:waypointPoiPoint>
          <wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>
        </wpml:waypointHeadingParam>`;
        }
      }

      const turnOverrideXml = !wp.useGlobalTurnParam
        ? `
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>${wp.turnMode || c.globalTurnMode}</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>${wp.turnDampingDist ?? 0}</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>`
        : "";

      return `
      <Placemark>
        <Point>
          <coordinates>${wp.longitude},${wp.latitude}</coordinates>
        </Point>
        <wpml:index>${wp.index}</wpml:index>
        <wpml:ellipsoidHeight>${wp.height}</wpml:ellipsoidHeight>
        <wpml:height>${wp.height}</wpml:height>
        <wpml:useGlobalHeight>${wp.useGlobalHeight ? 1 : 0}</wpml:useGlobalHeight>
        <wpml:useGlobalSpeed>${wp.useGlobalSpeed ? 1 : 0}</wpml:useGlobalSpeed>
        ${!wp.useGlobalSpeed ? `<wpml:waypointSpeed>${wp.speed}</wpml:waypointSpeed>` : ""}
        <wpml:useGlobalHeadingParam>${wp.useGlobalHeadingParam ? 1 : 0}</wpml:useGlobalHeadingParam>${headingOverrideXml}
        <wpml:useGlobalTurnParam>${wp.useGlobalTurnParam ? 1 : 0}</wpml:useGlobalTurnParam>${turnOverrideXml}
        <wpml:useStraightLine>0</wpml:useStraightLine>
        <wpml:gimbalPitchAngle>${wp.gimbalPitchAngle}</wpml:gimbalPitchAngle>${actionGroupXml}
        <wpml:isRisky>0</wpml:isRisky>
      </Placemark>`;
    })
    .join("");

  const globalHeight = mission.waypoints[0]?.height ?? 50;

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${WPML_NS}">
<Document>
  <wpml:createTime>${now}</wpml:createTime>
  <wpml:updateTime>${now}</wpml:updateTime>
${buildMissionConfigXml(c)}
  <Folder>
    <wpml:templateType>waypoint</wpml:templateType>
    <wpml:templateId>0</wpml:templateId>
    <wpml:waylineCoordinateSysParam>
      <wpml:coordinateMode>WGS84</wpml:coordinateMode>
      <wpml:heightMode>${c.heightMode}</wpml:heightMode>
      <wpml:positioningType>GPS</wpml:positioningType>
    </wpml:waylineCoordinateSysParam>
    <wpml:autoFlightSpeed>${c.autoFlightSpeed}</wpml:autoFlightSpeed>
    <wpml:globalHeight>${globalHeight}</wpml:globalHeight>
    <wpml:caliFlightEnable>0</wpml:caliFlightEnable>
    <wpml:gimbalPitchMode>${c.gimbalPitchMode}</wpml:gimbalPitchMode>
    <wpml:globalWaypointHeadingParam>
      <wpml:waypointHeadingMode>${c.globalHeadingMode}</wpml:waypointHeadingMode>
      <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>
      <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>
      <wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>
    </wpml:globalWaypointHeadingParam>
    <wpml:globalWaypointTurnMode>${c.globalTurnMode}</wpml:globalWaypointTurnMode>
    <wpml:globalUseStraightLine>0</wpml:globalUseStraightLine>${placemarks}
    <wpml:payloadParam>
      <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
      <wpml:imageFormat>${imageFormatFor(c.payloadEnumValue)}</wpml:imageFormat>
      <wpml:photoSize/>
    </wpml:payloadParam>
  </Folder>
</Document>
</kml>`;
}

// ── Waylines WPML ────────────────────────────────────────

export function buildWaylinesWpml(mission: Mission): string {
  const c = mission.config;
  const pois = mission.pois || [];

  let totalDistanceM = 0;
  for (let i = 1; i < mission.waypoints.length; i++) {
    const a = mission.waypoints[i - 1];
    const b = mission.waypoints[i];
    totalDistanceM += haversineM(
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude,
    );
  }
  // Informational estimate only (native Pilot 2 writes its own model's
  // numbers here) — cruise time plus a takeoff/landing allowance.
  const durationS = totalDistanceM / Math.max(c.autoFlightSpeed, 1) + 10;

  const placemarks = mission.waypoints
    .map((wp, i) => {
      const actionGroupXml = buildActionGroupXml(wp, i);
      // Unresolvable towardPOI falls back to the global mode (or
      // followWayline when the global itself is towardPOI) — never a
      // zeroed POI target.
      const h = resolveHeading(wp, c, pois) ?? {
        mode:
          c.globalHeadingMode === "towardPOI"
            ? "followWayline"
            : c.globalHeadingMode,
        angle: 0,
        poiPoint: ZERO_POI_POINT,
      };
      const turnMode = wp.useGlobalTurnParam
        ? c.globalTurnMode
        : wp.turnMode || c.globalTurnMode;
      const speed = wp.useGlobalSpeed ? c.autoFlightSpeed : wp.speed;

      return `
      <Placemark>
        <Point>
          <coordinates>${wp.longitude},${wp.latitude}</coordinates>
        </Point>
        <wpml:index>${wp.index}</wpml:index>
        <wpml:executeHeight>${wp.height}</wpml:executeHeight>
        <wpml:waypointSpeed>${speed}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>${h.mode}</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>${h.angle}</wpml:waypointHeadingAngle>
          <wpml:waypointPoiPoint>${h.poiPoint}</wpml:waypointPoiPoint>
          <wpml:waypointHeadingAngleEnable>${headingAngleEnable(h.mode)}</wpml:waypointHeadingAngleEnable>
          <wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>
        </wpml:waypointHeadingParam>
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>${turnMode}</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>${wp.turnDampingDist ?? 0}</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>
        <wpml:useStraightLine>0</wpml:useStraightLine>
        <wpml:waypointGimbalHeadingParam>
          <wpml:waypointGimbalPitchAngle>${wp.gimbalPitchAngle}</wpml:waypointGimbalPitchAngle>
          <wpml:waypointGimbalYawAngle>0</wpml:waypointGimbalYawAngle>
        </wpml:waypointGimbalHeadingParam>
        <wpml:isRisky>0</wpml:isRisky>${actionGroupXml}
        <wpml:waypointWorkType>0</wpml:waypointWorkType>
      </Placemark>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${WPML_NS}">
<Document>
${buildMissionConfigXml(c)}
  <Folder>
    <wpml:templateId>0</wpml:templateId>
    <wpml:executeHeightMode>${mapExecuteHeightMode(c.heightMode)}</wpml:executeHeightMode>
    <wpml:waylineId>0</wpml:waylineId>
    <wpml:distance>${totalDistanceM.toFixed(6)}</wpml:distance>
    <wpml:duration>${durationS.toFixed(6)}</wpml:duration>
    <wpml:autoFlightSpeed>${c.autoFlightSpeed}</wpml:autoFlightSpeed>
    <wpml:realTimeFollowSurfaceByFov>0</wpml:realTimeFollowSurfaceByFov>${placemarks}
  </Folder>
</Document>
</kml>`;
}
