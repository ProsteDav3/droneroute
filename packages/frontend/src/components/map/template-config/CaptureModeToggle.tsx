import { Label } from "@/components/ui/label";
import type { CaptureMode } from "@/lib/templates";

/** Photo (a shot at every waypoint) vs. video (record continuously start-to-finish) capture-mode picker, shared by all template types. */
export function CaptureModeToggle({
  value,
  onChange,
}: {
  value: CaptureMode;
  onChange: (mode: CaptureMode) => void;
}) {
  const optionClass = (mode: CaptureMode) =>
    `flex-1 h-7 rounded text-xs border transition-colors ${
      value === mode
        ? "bg-[#00c2ff]/15 border-[#00c2ff]/50 text-[#33cfff]"
        : "border-border text-muted-foreground hover:bg-muted"
    }`;
  return (
    <div>
      <Label
        className="text-[10px]"
        title="Foto: fotka na každém bodě trasy. Video: nahrávání se spustí na prvním bodě a zastaví na posledním, dron mezitím jen prolétá."
      >
        Záznam
      </Label>
      <div className="flex gap-1 mt-0.5">
        <button
          type="button"
          onClick={() => onChange("photo")}
          className={optionClass("photo")}
        >
          Foto
        </button>
        <button
          type="button"
          onClick={() => onChange("video")}
          className={optionClass("video")}
        >
          Video
        </button>
      </div>
    </div>
  );
}
