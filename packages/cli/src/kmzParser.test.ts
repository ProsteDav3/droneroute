import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseKmzToMissionJson } from "./kmzParser.js";

function buildTemplateKml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>10</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>99</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>1</wpml:droneSubEnumValue>
      </wpml:droneInfo>
      <wpml:payloadInfo>
        <wpml:payloadEnumValue>89</wpml:payloadEnumValue>
      </wpml:payloadInfo>
    </wpml:missionConfig>
    <Folder>
      <wpml:autoFlightSpeed>7</wpml:autoFlightSpeed>
      <Placemark>
        <Point><coordinates>0.9315,41.258,0</coordinates></Point>
        <wpml:index>0</wpml:index>
        <wpml:executeHeight>30</wpml:executeHeight>
        <wpml:waypointSpeed>7</wpml:waypointSpeed>
      </Placemark>
      <Placemark>
        <Point><coordinates>0.932,41.2585,0</coordinates></Point>
        <wpml:index>1</wpml:index>
        <wpml:executeHeight>35</wpml:executeHeight>
        <wpml:waypointSpeed>7</wpml:waypointSpeed>
      </Placemark>
    </Folder>
  </Document>
</kml>`;
}

async function buildKmzBuffer(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("wpmz/template.kml", buildTemplateKml());
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("parseKmzToMissionJson", () => {
  it("parses waypoints, coordinates and config out of a WPML KMZ", async () => {
    const buffer = await buildKmzBuffer();
    const result = await parseKmzToMissionJson(buffer);

    expect(result.waypoints).toHaveLength(2);
    expect(result.waypoints[0]).toMatchObject({
      index: 0,
      latitude: 41.258,
      longitude: 0.9315,
      height: 30,
    });
    expect(result.waypoints[1]).toMatchObject({
      index: 1,
      latitude: 41.2585,
      longitude: 0.932,
      height: 35,
    });
    expect(result.config.droneEnumValue).toBe(99);
    expect(result.config.autoFlightSpeed).toBe(7);
    expect(result.pois).toEqual([]);
  });

  it("throws when template.kml is missing", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "not a mission");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    await expect(parseKmzToMissionJson(buffer)).rejects.toThrow(
      "Invalid KMZ: missing template.kml",
    );
  });
});
