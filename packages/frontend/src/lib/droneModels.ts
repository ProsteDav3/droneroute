import { DRONE_MODELS } from "@droneroute/shared";
import type { MissionConfig } from "@droneroute/shared";

export interface DroneDescription {
  droneLabel: string;
  payloadLabel?: string;
}

/**
 * Human-readable drone + payload names for a mission's configured
 * droneEnumValue/droneSubEnumValue/payloadEnumValue, looked up from
 * `DRONE_MODELS`. Falls back to the raw enum values when the combination
 * isn't a known model (e.g. a KMZ imported from a third-party planner)
 * rather than guessing a name.
 */
export function describeDroneAndPayload(
  config: Pick<
    MissionConfig,
    "droneEnumValue" | "droneSubEnumValue" | "payloadEnumValue"
  >,
): DroneDescription {
  const drone = DRONE_MODELS.find(
    (d) =>
      d.droneEnumValue === config.droneEnumValue &&
      d.droneSubEnumValue === config.droneSubEnumValue,
  );
  if (!drone) {
    return {
      droneLabel: `Neznámý dron (${config.droneEnumValue}/${config.droneSubEnumValue})`,
    };
  }
  const payload = drone.payloads.find(
    (p) => p.payloadEnumValue === config.payloadEnumValue,
  );
  return {
    droneLabel: drone.label,
    payloadLabel: payload?.label,
  };
}
