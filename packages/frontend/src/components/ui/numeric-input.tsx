import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Input } from "./input";

interface NumericInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  fallback: number;
  integer?: boolean;
  className?: string;
  /**
   * Accessible name for the input. The panels lay a `<Label>` out above the
   * field rather than wiring `htmlFor`/`id`, so without this a screen reader
   * announces a bare spinbutton with no idea which of a dozen numeric
   * fields it is.
   */
  ariaLabel?: string;
}

/**
 * A numeric input that fires `onChange` live as soon as what's typed parses
 * to a real number — so linked fields elsewhere in the panel (e.g. Orbit's
 * radius/altitude/POI-height framing) recalculate immediately instead of
 * only after clicking away. Min/max clamping still only happens on blur,
 * so typing a multi-digit number that starts out of range (e.g. "5" on the
 * way to "50" with a min of 30) doesn't get snapped mid-keystroke, and
 * clearing the field to retype doesn't fire a spurious fallback value.
 */
export function NumericInput({
  value,
  onChange,
  min,
  max,
  step,
  fallback,
  integer,
  className,
  ariaLabel,
}: NumericInputProps) {
  const [localValue, setLocalValue] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);

  // Sync from external value changes (but not while the user is typing)
  useEffect(() => {
    if (!isFocused) {
      setLocalValue(String(value));
    }
  }, [value, isFocused]);

  const clamp = useCallback(
    (raw: string): number => {
      const parsed = integer ? parseInt(raw) : parseFloat(raw);
      let val = isNaN(parsed) ? fallback : parsed;
      if (min !== undefined) val = Math.max(min, val);
      if (max !== undefined) val = Math.min(max, val);
      return val;
    },
    [min, max, fallback, integer],
  );

  const handleBlur = () => {
    setIsFocused(false);
    const clamped = clamp(localValue);
    setLocalValue(String(clamped));
    // Only report a change if the value actually changed. Blurring an
    // untouched field used to fire onChange(value) anyway — harmless for a
    // plain number, but a field whose "unset" state means "automatic" (the
    // orbit panel's aim height: undefined = follow the middle of the object)
    // got silently pinned to whatever it happened to display, just by being
    // tabbed through. That is how a user's orbit ended up with aimHeight 9
    // baked in and re-applying the template couldn't move it.
    if (clamped !== value) onChange(clamped);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setLocalValue(raw);
    const parsed = integer ? parseInt(raw) : parseFloat(raw);
    if (!isNaN(parsed) && isFinite(parsed)) {
      onChange(parsed);
    }
  };

  return (
    <Input
      type="number"
      aria-label={ariaLabel}
      value={localValue}
      onChange={handleChange}
      onFocus={() => setIsFocused(true)}
      onBlur={handleBlur}
      min={min}
      max={max}
      step={step}
      className={className}
    />
  );
}
