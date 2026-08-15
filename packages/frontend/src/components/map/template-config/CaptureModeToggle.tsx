import { Label } from "@/components/ui/label";
import { CINEMA_SPEED_MPS, type CaptureMode } from "@/lib/templates";

/** What the toggle reports back: the capture mode, plus cinema pacing when the panel offers it. */
export interface CaptureSelection {
  mode: CaptureMode;
  cinema: boolean;
}

/**
 * Photo (a shot at every waypoint) vs. video (record continuously
 * start-to-finish) capture-mode picker, shared by all template types.
 *
 * `cinema`, when supplied, adds a third button — "Cinema video" — that is
 * still video capture, just paced at `CINEMA_SPEED_MPS`. It is modelled as
 * a flag alongside the mode rather than a third mode value on purpose: the
 * generators and every other panel branch on `"video"`/`"photo"`, and a
 * third value would slip through those checks and quietly record nothing.
 * Panels that don't offer cinema pacing simply don't pass the prop.
 *
 * Reports mode and cinema together in ONE callback so a panel can apply
 * both in a single state update — two back-to-back updates built from the
 * same closed-over params would overwrite each other.
 */
export function CaptureModeToggle({
  value,
  onChange,
  cinema,
}: {
  value: CaptureMode;
  onChange: (selection: CaptureSelection) => void;
  cinema?: { enabled: boolean };
}) {
  const isCinema = value === "video" && !!cinema?.enabled;
  const isPlainVideo = value === "video" && !isCinema;
  const optionClass = (selected: boolean) =>
    `flex-1 h-7 rounded text-xs border transition-colors ${
      selected
        ? "bg-[#00c2ff]/15 border-[#00c2ff]/50 text-[#33cfff]"
        : "border-border text-muted-foreground hover:bg-muted"
    }`;
  return (
    <div>
      <Label
        className="text-[10px]"
        title={
          cinema
            ? `Foto: fotka na každém bodě trasy. Video: nahrávání se spustí na prvním bodě a zastaví na posledním. Cinema video: totéž, ale dron letí nejvýš ${CINEMA_SPEED_MPS} m/s pro plynulý, filmový záběr.`
            : "Foto: fotka na každém bodě trasy. Video: nahrávání se spustí na prvním bodě a zastaví na posledním, dron mezitím jen prolétá."
        }
      >
        Záznam
      </Label>
      <div className="flex gap-1 mt-0.5">
        <button
          type="button"
          onClick={() => onChange({ mode: "photo", cinema: false })}
          className={optionClass(value === "photo")}
        >
          Foto
        </button>
        <button
          type="button"
          onClick={() => onChange({ mode: "video", cinema: false })}
          className={optionClass(isPlainVideo)}
        >
          Video
        </button>
        {cinema && (
          <button
            type="button"
            onClick={() => onChange({ mode: "video", cinema: true })}
            className={optionClass(isCinema)}
            title={`Video s rychlostí nejvýš ${CINEMA_SPEED_MPS} m/s.`}
          >
            Cinema video
          </button>
        )}
      </div>
    </div>
  );
}
