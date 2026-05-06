import { useMissionStore } from "@/store/missionStore";
import type { PointOfInterest } from "@droneroute/shared";
import { useCallback, useEffect, useState } from "react";
import { Marker3D } from "./Marker3D";

interface PoiMarkerProps {
  poi: PointOfInterest;
  is3D: boolean;
}

export function PoiMarker({ poi, is3D }: PoiMarkerProps) {
  const {
    selectedPoiId,
    selectPoi,
    movePoi,
    selectedWaypointIndices,
    updateWaypoint,
  } = useMissionStore();
  const isSelected = selectedPoiId === poi.id;
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const hasSelectedWaypoints = selectedWaypointIndices.size > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta")
        setCtrlHeld(e.type === "keydown");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  const ctrlReady = ctrlHeld && hasSelectedWaypoints;
  const bg = isSelected ? "#ef4444" : "#dc2626";
  const border = isSelected ? "#fca5a5" : "#991b1b";

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && hasSelectedWaypoints) {
        for (const idx of selectedWaypointIndices) {
          updateWaypoint(idx, {
            headingMode: "towardPOI",
            poiId: poi.id,
            useGlobalHeadingParam: false,
          });
        }
      } else {
        selectPoi(poi.id);
      }
    },
    [
      hasSelectedWaypoints,
      selectedWaypointIndices,
      updateWaypoint,
      poi.id,
      selectPoi,
    ],
  );

  const handleDragEnd = useCallback(
    (e: { lngLat: { lng: number; lat: number } }) => {
      movePoi(poi.id, e.lngLat.lat, e.lngLat.lng);
    },
    [poi.id, movePoi],
  );

  return (
    <Marker3D
      longitude={poi.longitude}
      latitude={poi.latitude}
      altitude={is3D ? poi.height : 0}
      anchor="center"
      draggable
      onDragEnd={handleDragEnd}
    >
      <div
        onClick={handleClick}
        title={`${poi.name}\nHeight: ${poi.height}m${ctrlReady ? "\nCtrl+click to aim waypoints here" : ""}`}
        style={{
          background: bg,
          border: `2px solid ${border}`,
          color: "white",
          width: 24,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          cursor: ctrlReady ? "crosshair" : "grab",
          clipPath: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
        }}
      >
        &#x25CE;
      </div>
    </Marker3D>
  );
}
