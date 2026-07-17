import { describe, it, expect, beforeEach } from "vitest";
import {
  handleMessage,
  getTelemetrySnapshot,
  onTelemetryUpdate,
  stopTelemetryBridge,
} from "./mqttTelemetry.js";

describe("mqttTelemetry — message parsing", () => {
  beforeEach(() => {
    stopTelemetryBridge();
  });

  it("ignores topics that don't match the expected sys/thing product pattern", () => {
    handleMessage("unrelated/topic", Buffer.from("{}"));
    expect(getTelemetrySnapshot()).toHaveLength(0);
  });

  it("ignores malformed (non-JSON) payloads without throwing", () => {
    expect(() =>
      handleMessage("thing/product/SN123/osd", Buffer.from("not json")),
    ).not.toThrow();
    expect(getTelemetrySnapshot()).toHaveLength(0);
  });

  it("records device online status from a status topic", () => {
    handleMessage(
      "sys/product/SN123/status",
      Buffer.from(JSON.stringify({ data: { online: true } })),
    );
    const snapshot = getTelemetrySnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ deviceSn: "SN123", online: true });
  });

  it("parses OSD telemetry (position/battery/speed) from an osd topic", () => {
    handleMessage(
      "thing/product/SN123/osd",
      Buffer.from(
        JSON.stringify({
          data: {
            latitude: 50.1,
            longitude: 14.5,
            height: 42,
            horizontal_speed: 5.5,
            vertical_speed: 0.2,
            attitude_head: 180,
            battery: { capacity_percent: 87 },
          },
        }),
      ),
    );
    const [record] = getTelemetrySnapshot();
    expect(record).toMatchObject({
      deviceSn: "SN123",
      online: true,
      latitude: 50.1,
      longitude: 14.5,
      height: 42,
      horizontalSpeed: 5.5,
      verticalSpeed: 0.2,
      attitudeHead: 180,
      batteryPercent: 87,
    });
  });

  it("parses home distance, wind speed, per-cell battery, and nested GPS quality", () => {
    handleMessage(
      "thing/product/SN123/osd",
      Buffer.from(
        JSON.stringify({
          data: {
            home_distance: 123.4,
            wind_speed: 3.2,
            position_state: { gps_number: 14 },
            battery: {
              capacity_percent: 47,
              batteries: [{ capacity_percent: 40 }, { capacity_percent: 54 }],
            },
          },
        }),
      ),
    );
    const [record] = getTelemetrySnapshot();
    expect(record).toMatchObject({
      homeDistance: 123.4,
      windSpeed: 3.2,
      gpsQuality: 14,
      batteryPercent: 47,
      batteryPercents: [40, 54],
    });
  });

  it("parses an RC/dock's own flat capacity_percent battery field, not just the aircraft's nested one", () => {
    handleMessage(
      "thing/product/RC123/osd",
      Buffer.from(
        JSON.stringify({
          data: { capacity_percent: 25, wireless_link: { sdr_quality: 5 } },
        }),
      ),
    );
    const [record] = getTelemetrySnapshot();
    expect(record.batteryPercent).toBe(25);
  });

  it("parses signal quality from a wireless_link object (RC/dock OSD, not the aircraft's)", () => {
    handleMessage(
      "thing/product/RC123/osd",
      Buffer.from(
        JSON.stringify({
          data: { wireless_link: { sdr_quality: 4, "4g_quality": 2 } },
        }),
      ),
    );
    const [record] = getTelemetrySnapshot();
    expect(record.signalQuality).toBe(4);
  });

  it("falls back to 4g_quality when sdr_quality isn't present", () => {
    handleMessage(
      "thing/product/RC123/osd",
      Buffer.from(
        JSON.stringify({ data: { wireless_link: { "4g_quality": 3 } } }),
      ),
    );
    const [record] = getTelemetrySnapshot();
    expect(record.signalQuality).toBe(3);
  });

  it("merges successive updates for the same device rather than overwriting the whole record", () => {
    handleMessage(
      "thing/product/SN123/osd",
      Buffer.from(
        JSON.stringify({ data: { latitude: 50.1, longitude: 14.5 } }),
      ),
    );
    handleMessage(
      "thing/product/SN123/osd",
      Buffer.from(JSON.stringify({ data: { height: 42 } })),
    );
    const [record] = getTelemetrySnapshot();
    expect(record.latitude).toBe(50.1);
    expect(record.longitude).toBe(14.5);
    expect(record.height).toBe(42);
  });

  it("tracks multiple devices independently", () => {
    handleMessage(
      "thing/product/AAA/osd",
      Buffer.from(JSON.stringify({ data: { latitude: 1 } })),
    );
    handleMessage(
      "thing/product/BBB/osd",
      Buffer.from(JSON.stringify({ data: { latitude: 2 } })),
    );
    const snapshot = getTelemetrySnapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.map((d) => d.deviceSn).sort()).toEqual(["AAA", "BBB"]);
  });

  it("notifies subscribers via onTelemetryUpdate", () => {
    const updates: string[] = [];
    const unsubscribe = onTelemetryUpdate((record) => {
      updates.push(record.deviceSn);
    });

    handleMessage(
      "thing/product/SN123/osd",
      Buffer.from(JSON.stringify({ data: { latitude: 1 } })),
    );
    unsubscribe();
    handleMessage(
      "thing/product/SN123/osd",
      Buffer.from(JSON.stringify({ data: { latitude: 2 } })),
    );

    expect(updates).toEqual(["SN123"]);
  });

  it("stopTelemetryBridge clears all tracked device state", () => {
    handleMessage(
      "thing/product/SN123/osd",
      Buffer.from(JSON.stringify({ data: { latitude: 1 } })),
    );
    expect(getTelemetrySnapshot()).toHaveLength(1);

    stopTelemetryBridge();

    expect(getTelemetrySnapshot()).toHaveLength(0);
  });
});
