'use client';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /**
   * Accessible label. Passed through as `aria-label` so screen readers
   * announce what the switch controls. Use this when the toggle has no
   * adjacent text label.
   */
  label?: string;
  /**
   * Id of the element holding the switch's visible label. Use this instead of
   * `label` when the text is rendered beside the switch: an `aria-label`
   * duplicating visible text makes screen readers announce the name twice.
   */
  labelledBy?: string;
  /** Visual size; default is the standard 36px wide switch. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * iOS-style toggle switch. Drop-in replacement for boolean checkboxes
 * where a single on/off setting reads more naturally as a toggle than
 * a tick-box (preferences, feature flags, single config options).
 *
 * Renders as a button with role="switch" and aria-checked, so it's
 * still announced correctly to assistive tech.
 */
export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
  labelledBy,
  size = 'md',
  className,
}: ToggleSwitchProps) {
  const dims =
    size === 'sm'
      ? { track: 'h-4 w-7', knob: 'h-3 w-3', knobOn: 'translate-x-3.5', knobOff: 'translate-x-0.5' }
      : { track: 'h-5 w-9', knob: 'h-4 w-4', knobOn: 'translate-x-[1.125rem]', knobOff: 'translate-x-0.5' };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex flex-shrink-0 items-center rounded-full transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800',
        dims.track,
        checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span
        className={[
          'inline-block transform rounded-full bg-white shadow transition-transform',
          dims.knob,
          checked ? dims.knobOn : dims.knobOff,
        ].join(' ')}
      />
    </button>
  );
}
