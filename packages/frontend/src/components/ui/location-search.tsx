import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useConfigStore } from "@/store/configStore";

interface LocationSearchProps {
  /** Called with [lat, lng] once an address is geocoded or coordinates are parsed. */
  onLocationFound: (lat: number, lng: number) => void;
  placeholder?: string;
  className?: string;
}

/** Matches "lat, lng" or "lat lng", e.g. "50.0623, 14.4286". */
function parseCoordinates(input: string): [number, number] | null {
  const match = input
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

/**
 * A small "address or coordinates" search box. Typing a lat/lng pair jumps
 * straight there; typing free text geocodes it via the Mapbox Geocoding API
 * (reusing the same MAPBOX_TOKEN already used for the map itself).
 */
export function LocationSearch({
  onLocationFound,
  placeholder = "Adresa nebo lat, lng",
  className = "",
}: LocationSearchProps) {
  const mapboxToken = useConfigStore((s) => s.mapboxToken);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const coords = parseCoordinates(trimmed);
    if (coords) {
      setError(null);
      onLocationFound(coords[0], coords[1]);
      return;
    }

    if (!mapboxToken) {
      setError("Mapbox token není nastaven");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        trimmed,
      )}.json?access_token=${encodeURIComponent(mapboxToken)}&limit=1`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("geocoding request failed");
      const data = await res.json();
      const feature = data.features?.[0];
      if (!feature) {
        setError("Adresa nebyla nalezena");
        return;
      }
      const [lng, lat] = feature.center as [number, number];
      onLocationFound(lat, lng);
    } catch {
      setError(
        "Vyhledávání selhalo — zkuste to znovu nebo zadejte souřadnice přímo",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex gap-1">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearch();
            }
          }}
          placeholder={placeholder}
          className="h-7 text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          title="Hledat"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Search className="h-3 w-3" />
          )}
        </Button>
      </div>
      {error && (
        <div className="text-[10px] text-destructive mt-0.5">{error}</div>
      )}
    </div>
  );
}
