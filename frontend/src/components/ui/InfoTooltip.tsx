'use client';

import { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';

interface InfoTooltipProps {
  /** Tooltip body text. Shown in the popover and exposed via aria-label. */
  text: string;
  /** Where the popover renders relative to the icon. Defaults to 'bottom'. */
  placement?: 'top' | 'bottom';
  /**
   * Horizontal edge the popover anchors to. Use 'right' (opens leftward) when
   * the icon sits near a container's right edge -- e.g. the right column of a
   * modal -- so the fixed-width popover doesn't overflow and get clipped.
   * Defaults to the natural alignment for the placement (left for 'bottom',
   * centered for 'top').
   */
  align?: 'left' | 'right';
  /** Tailwind size classes for the icon. Defaults to 'h-4 w-4'. */
  iconClassName?: string;
  /**
   * Render the popover in a fixed-position portal on document.body so it
   * escapes ancestors that clip overflow (e.g. a scrollable card). The
   * position is clamped to the viewport so it never gets cut off.
   */
  usePortal?: boolean;
}

const POPOVER_WIDTH = 256; // matches w-64
const VIEWPORT_MARGIN = 8;

/**
 * Inline help icon with a desktop-only hover popover. Hidden below the md
 * breakpoint because a hover popover can't be triggered on touch. The text
 * is exposed via aria-label for screen readers; no native title attribute
 * is used so the browser tooltip doesn't duplicate the styled popover.
 *
 * The trigger is a `<button>`, not a focusable `<span>`. A span's implicit role
 * is generic, which screen readers do not announce and whose `aria-label` they
 * therefore drop -- so a `tabIndex` on one produces a tab stop that says
 * nothing, repeated wherever this component appears. The button carries the
 * label, is reachable by keyboard, and shows the same popover on focus.
 *
 * Escape dismisses the popover without moving focus, per WCAG 1.4.13.
 */
export function InfoTooltip({
  text,
  placement = 'bottom',
  align,
  iconClassName = 'h-4 w-4',
  usePortal = false,
}: InfoTooltipProps) {
  const iconRef = useRef<HTMLButtonElement>(null);
  const [portalPos, setPortalPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  /** Only used by the CSS-driven variant, whose popover has no state of its own. */
  const [dismissed, setDismissed] = useState(false);

  const showPortal = useCallback(() => {
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
    );
    const top =
      placement === 'top' ? rect.top : rect.bottom + 4;
    setPortalPos({ top, left });
  }, [placement]);

  const hidePortal = useCallback(() => setPortalPos(null), []);

  /**
   * Escape closes the help without taking focus away from the trigger.
   *
   * The key is claimed only while a popover is actually up. `Modal` closes on a
   * document-level keydown listener, which a stopped event never reaches, so
   * stopping propagation unconditionally ate every Escape after the first for
   * as long as a tooltip trigger held focus -- one dismissed the tooltip
   * (correct, WCAG 1.4.13) and the modal around it could then not be closed
   * from the keyboard at all. With nothing showing, this component has no claim
   * on the key and lets it through.
   */
  const dismissOnEscape = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, showing: boolean) => {
      if (event.key !== 'Escape') return;
      if (!showing) return;
      event.stopPropagation();
      hidePortal();
      setDismissed(true);
    },
    [hidePortal],
  );

  const triggerClasses =
    'relative hidden md:inline-flex items-center align-middle ml-1 text-gray-400 hover:text-blue-500 focus-visible:text-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded transition-colors cursor-help';

  if (usePortal) {
    return (
      <button
        type="button"
        ref={iconRef}
        aria-label={text}
        onMouseEnter={showPortal}
        onMouseLeave={hidePortal}
        onFocus={showPortal}
        onBlur={hidePortal}
        // A help icon acts on itself. Inside a clickable row or card the click
        // would otherwise bubble and navigate away from the thing being
        // explained -- the same rule the row's other inner controls follow.
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => dismissOnEscape(event, portalPos !== null)}
        className={triggerClasses}
      >
        <QuestionMarkCircleIcon className={iconClassName} aria-hidden="true" />
        {portalPos &&
          createPortal(
            <span
              role="tooltip"
              style={{
                position: 'fixed',
                top: portalPos.top,
                left: portalPos.left,
                width: POPOVER_WIDTH,
                transform: placement === 'top' ? 'translateY(-100%)' : undefined,
              }}
              className="pointer-events-none z-50 whitespace-normal rounded-md bg-gray-900 dark:bg-gray-700 px-2.5 py-2 text-xs font-normal leading-snug text-white shadow-lg"
            >
              {text}
            </span>,
            document.body,
          )}
      </button>
    );
  }

  const vertical = placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-1';
  const horizontal =
    align === 'right'
      ? 'right-0'
      : align === 'left'
        ? 'left-0'
        : placement === 'top'
          ? 'left-1/2 -translate-x-1/2'
          : 'left-0';
  // The popover is shown by CSS on hover/focus of the group. Escape has to win
  // over that, and re-arm the next time the pointer or focus arrives.
  const visibility = dismissed
    ? 'hidden'
    : 'hidden md:group-hover/tip:block md:group-focus/tip:block';
  const popoverClasses = `${horizontal} ${vertical}`;
  return (
    <button
      type="button"
      aria-label={text}
      // A keydown on this button means it holds focus, so `group-focus` has the
      // popover open unless Escape already closed it -- `dismissed` is the only
      // thing that can be false about "showing" here.
      onKeyDown={(event) => dismissOnEscape(event, !dismissed)}
      // As above: explaining a row is not activating it.
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
      className={`${triggerClasses} group/tip`}
    >
      <QuestionMarkCircleIcon className={iconClassName} aria-hidden="true" />
      <span
        role="tooltip"
        className={`pointer-events-none ${visibility} absolute z-20 w-64 whitespace-normal rounded-md bg-gray-900 dark:bg-gray-700 px-2.5 py-2 text-xs font-normal leading-snug text-white shadow-lg ${popoverClasses}`}
      >
        {text}
      </span>
    </button>
  );
}
