import { Marker } from "react-map-gl/mapbox";
import type { TemplateResult } from "@/lib/templates";

interface TemplatePreviewProps {
  result: TemplateResult;
}

export function TemplatePreview({ result }: TemplatePreviewProps) {
  const { waypoints, pois } = result;

  return (
    <>
      {/* Waypoint markers */}
      {waypoints.map((wp, i) => (
        <Marker
          key={`preview-wp-${i}`}
          longitude={wp.longitude}
          latitude={wp.latitude}
          anchor="center"
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#c4b5fd",
              border: "2px solid #a78bfa",
              opacity: 0.8,
            }}
          />
        </Marker>
      ))}

      {/* POI markers */}
      {pois.map((poi, i) => (
        <Marker
          key={`preview-poi-${i}`}
          longitude={poi.longitude}
          latitude={poi.latitude}
          anchor="center"
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#fbbf24",
              border: "2px solid #f59e0b",
              opacity: 0.8,
            }}
          />
        </Marker>
      ))}
    </>
  );
}
