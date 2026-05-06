import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/mapbox";
import mapboxgl from "mapbox-gl";

interface Marker3DProps {
  longitude: number;
  latitude: number;
  /** Altitude in meters above ground level (AGL). Uses marker.setAltitude(). */
  altitude?: number;
  anchor?: "center" | "top" | "bottom" | "left" | "right";
  draggable?: boolean;
  onDragStart?: () => void;
  onDrag?: (e: { lngLat: { lng: number; lat: number } }) => void;
  onDragEnd?: (e: { lngLat: { lng: number; lat: number } }) => void;
  children: React.ReactNode;
}

/**
 * A Marker component that supports 3D altitude positioning above ground.
 * Uses the native mapbox-gl Marker.setAltitude() API which positions the
 * marker at the given meters above the map plane (terrain surface when
 * terrain is enabled).
 */
export function Marker3D({
  longitude,
  latitude,
  altitude = 0,
  anchor = "center",
  draggable = false,
  onDragStart,
  onDrag,
  onDragEnd,
  children,
}: Marker3DProps) {
  const { current: mapRef } = useMap();
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onDragStart, onDrag, onDragEnd });
  callbacksRef.current = { onDragStart, onDrag, onDragEnd };

  // Create the marker container element once
  if (!containerRef.current) {
    containerRef.current = document.createElement("div");
  }

  // Create the marker
  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef.getMap();

    const el = containerRef.current!;
    const marker = new mapboxgl.Marker({
      element: el,
      anchor,
      draggable,
    });

    marker.setLngLat([longitude, latitude]);
    (marker as any).setAltitude(altitude);
    marker.addTo(map);
    markerRef.current = marker;

    // Attach drag event handlers
    if (draggable) {
      marker.on("dragstart", () => {
        callbacksRef.current.onDragStart?.();
      });
      marker.on("drag", () => {
        const lngLat = marker.getLngLat();
        callbacksRef.current.onDrag?.({
          lngLat: { lng: lngLat.lng, lat: lngLat.lat },
        });
      });
      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        callbacksRef.current.onDragEnd?.({
          lngLat: { lng: lngLat.lng, lat: lngLat.lat },
        });
      });
    }

    return () => {
      marker.remove();
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, draggable, anchor]);

  // Update position when coordinates/altitude change
  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.setLngLat([longitude, latitude]);
      (markerRef.current as any).setAltitude(altitude);
    }
  }, [longitude, latitude, altitude]);

  return containerRef.current
    ? createPortal(children, containerRef.current)
    : null;
}
