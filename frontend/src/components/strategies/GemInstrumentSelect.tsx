"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, PlusIcon } from "@heroicons/react/24/outline";
import { useClickOutside } from "@/hooks/useClickOutside";
import { cn } from "@/lib/utils";
import { Security } from "@/types/investment";
import {
  GEM_SUGGESTION_REGIONS,
  GemSuggestedSecurity,
  GemSuggestionRegion,
  symbolKey,
} from "@/lib/gem-suggested-securities";

interface GemInstrumentSelectProps {
  /** The role being assigned; only used to build stable element ids. */
  role: string;
  /** Accessible name for the control, and the visible field label. */
  label: string;
  /** Assigned security id, or '' for a role left unassigned. */
  value: string;
  /** Instruments the portfolio already holds and can be pointed at. */
  securities: Security[];
  /**
   * Every instrument the user holds, keyed by `symbolKey` -- deactivated ones
   * included, which is why it is not derived from `securities`.
   *
   * A suggestion is "already owned" when this map has its symbol, because that
   * is exactly when the server would refuse to create it. A deactivated
   * instrument is absent from the pick-list and still owns its symbol, so
   * matching against what is merely selectable would offer a create that
   * cannot succeed.
   */
  ownedBySymbol: ReadonlyMap<string, Security>;
  /** Suggested instruments for this role, one per region. */
  suggestions: readonly GemSuggestedSecurity[];
  onChange: (securityId: string) => void;
  /** Chosen a suggestion: the caller opens the create form prefilled from it. */
  onPickSuggestion: (suggestion: GemSuggestedSecurity) => void;
  disabled?: boolean;
  error?: string;
}

/** How long a typeahead buffer survives between keystrokes. */
const TYPEAHEAD_RESET_MS = 800;

/**
 * One entry of the popup, in the order it is rendered, so the keyboard has a
 * single index space to move through whatever the grouping looks like.
 */
type Row =
  | {
      kind: "suggestion";
      key: string;
      /** The instrument the portfolio already holds for it, if any. */
      owned: Security | undefined;
      suggestion: GemSuggestedSecurity;
      /** What typeahead matches against. */
      match: string;
    }
  | { kind: "none"; key: string; match: string }
  | { kind: "security"; key: string; security: Security; match: string };

/**
 * The instrument for one GEM role: a dropdown over what the portfolio already
 * holds, with the suggested ETFs for that role pinned above it.
 *
 * The suggestions are the point. A strategy needs five specific kinds of fund
 * and a portfolio that has never run one offers nothing to select, which left
 * the only path through a create form the investor had to know what to type
 * into. Here the fund is named -- per region, because the same index trades as
 * a different listing in the US and in Europe -- and picking one opens the
 * create form already filled in, where the exchange and currency can still be
 * corrected to whatever the broker actually trades.
 *
 * There is no search box: the list is five suggestions plus the securities of
 * one portfolio, and the whole thing fits on screen. Typeahead stands in for it
 * -- typing `IE` jumps to IEMG.
 *
 * **Not the shared `Combobox`,** deliberately, and this is the one place in the
 * app where that is true of a picker. `Combobox` is a flat list of
 * `{value, label, subtitle}` with a single action per row and one `onCreateNew`
 * that takes typed text. This control needs region-grouped sections and *two*
 * actions per row -- select the instrument the user already owns, or open the
 * create form prefilled from a named listing -- neither of which that shape can
 * express. What it must not do is skip the keyboard behaviour `Combobox`
 * carries, which is why the arrow keys, Home/End, typeahead and roving focus
 * are all implemented here rather than left to Tab.
 */
export function GemInstrumentSelect({
  role,
  label,
  value,
  securities,
  ownedBySymbol,
  suggestions,
  onChange,
  onPickSuggestion,
  disabled = false,
  error,
}: GemInstrumentSelectProps) {
  const t = useTranslations("strategies");
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** Which entry to focus once the popup has actually rendered. */
  const pendingFocus = useRef<number | null>(null);
  const typeahead = useRef<{ buffer: string; at: number }>({
    buffer: "",
    at: 0,
  });

  // The options do not exist until the popup commits, so opening with the
  // keyboard records which entry it wanted and focuses it here.
  useEffect(() => {
    if (!isOpen) return;
    const index = pendingFocus.current;
    pendingFocus.current = null;
    if (index === null) return;
    optionRefs.current[index]?.focus();
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  useClickOutside(wrapperRef, () => setIsOpen(false), {
    enabled: isOpen,
    onEscape: close,
  });

  const labelId = `gem-instrument-label-${role}`;
  const listboxId = `gem-instrument-list-${role}`;
  const selected = securities.find((security) => security.id === value);
  const regionLabel = (region: GemSuggestionRegion): string =>
    t(`gem.settingsForm.regions.${region}` as Parameters<typeof t>[0]);

  const choose = (securityId: string) => {
    onChange(securityId);
    close();
  };

  const pick = (suggestion: GemSuggestedSecurity) => {
    setIsOpen(false);
    onPickSuggestion(suggestion);
  };

  /**
   * Each suggestion paired with the instrument the portfolio already holds for
   * it, when there is one.
   *
   * A suggestion the user already owns used to be dropped from this group
   * entirely, on the reasoning that it needs no creating. What that produced is
   * the opposite of the intent: the fund this role should point at was the one
   * fund the picker said nothing about, buried somewhere in "Your instruments"
   * among everything else the portfolio holds, while the recommendations on
   * offer were exactly the instruments Monize did not have yet. The advice
   * disappeared the moment it became actionable in one click.
   *
   * So both stay, and `owned` decides what picking one does: select the
   * instrument, or open the create form prefilled from the suggestion.
   */
  const offered = suggestions.map((suggestion) => ({
    suggestion,
    // Symbol identity, because that is the identity the server enforces: one
    // security per symbol per user. Requiring the exchange and currency to
    // agree as well made an instrument the user demonstrably owns look absent,
    // and the create it then offered was refused every time. See `symbolKey`.
    owned: ownedBySymbol.get(symbolKey(suggestion)),
  }));

  /** Every entry, in render order. The keyboard walks this, the DOM mirrors it. */
  const rows: Row[] = [
    ...GEM_SUGGESTION_REGIONS.flatMap((region) =>
      offered
        .filter(({ suggestion }) => suggestion.region === region)
        .map(
          ({ suggestion, owned }): Row => ({
            kind: "suggestion",
            key: `${suggestion.region}-${suggestion.symbol}`,
            suggestion,
            owned,
            match: owned ? owned.symbol : suggestion.symbol,
          }),
        ),
    ),
    { kind: "none", key: "none", match: t("gem.settingsForm.noInstrument") },
    ...securities.map(
      (security): Row => ({
        kind: "security",
        key: security.id,
        security,
        match: security.symbol,
      }),
    ),
  ];
  const indexOfRow = new Map(rows.map((row, index) => [row.key, index]));

  const activate = (row: Row) => {
    if (row.kind === "none") return choose("");
    if (row.kind === "security") return choose(row.security.id);
    return row.owned ? choose(row.owned.id) : pick(row.suggestion);
  };

  /** Move focus onto an entry, wrapping at both ends as a listbox does. */
  const focusOption = (index: number) => {
    if (rows.length === 0) return;
    const wrapped = (index + rows.length) % rows.length;
    optionRefs.current[wrapped]?.focus();
  };

  const openAndFocus = (index: number) => {
    if (rows.length === 0) return;
    pendingFocus.current = (index + rows.length) % rows.length;
    setIsOpen(true);
    // Already open: nothing is going to commit, so move focus now.
    if (isOpen) {
      const target = pendingFocus.current;
      pendingFocus.current = null;
      focusOption(target);
    }
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        openAndFocus(0);
        break;
      case "ArrowUp":
        event.preventDefault();
        openAndFocus(rows.length - 1);
        break;
      case "Home":
        if (!isOpen) return;
        event.preventDefault();
        focusOption(0);
        break;
      case "End":
        if (!isOpen) return;
        event.preventDefault();
        focusOption(rows.length - 1);
        break;
      default:
        break;
    }
  };

  const onOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption(index + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusOption(index - 1);
        return;
      case "Home":
        event.preventDefault();
        focusOption(0);
        return;
      case "End":
        event.preventDefault();
        focusOption(rows.length - 1);
        return;
      case "Escape":
        event.preventDefault();
        close();
        return;
      case "Tab":
        // A popup does not hold the tab sequence: leaving it closes it.
        setIsOpen(false);
        return;
      default:
        break;
    }

    // Typeahead: the list has no search box, so a symbol typed at it jumps to
    // the matching entry. Consecutive keystrokes extend the buffer, which is
    // what makes `IE` land on IEMG rather than on whatever starts with `E`.
    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey)
      return;
    // The event's own timestamp, not `Date.now()`: a clock read is an impure
    // call and the purity lint refuses one anywhere a render could reach.
    const now = event.timeStamp;
    const previous = typeahead.current;
    const buffer =
      now - previous.at > TYPEAHEAD_RESET_MS
        ? event.key
        : previous.buffer + event.key;
    typeahead.current = { buffer, at: now };
    // One character repeated is the "show me the next entry starting with this"
    // gesture, not a search for `ii` -- the same rule the ARIA practices give,
    // and the reason it does not depend on how fast the user types.
    const repeated =
      buffer.length > 1 && [...buffer].every((char) => char === buffer[0]);
    const needle = (repeated ? buffer[0] : buffer).toLowerCase();
    // A fresh single character searches from the *next* entry, so repeating it
    // cycles instead of settling on whichever one is already focused.
    const offset = repeated || buffer.length === 1 ? 1 : 0;
    const hit = rows
      .map((row, at) => ({ row, at }))
      .sort(
        (a, b) =>
          ((a.at - index - offset + rows.length) % rows.length) -
          ((b.at - index - offset + rows.length) % rows.length),
      )
      .find(({ row }) => row.match.toLowerCase().startsWith(needle));
    if (hit) {
      event.preventDefault();
      focusOption(hit.at);
    }
  };

  /** Shared props for an entry, so every one is navigable the same way. */
  const optionProps = (row: Row) => {
    const index = indexOfRow.get(row.key) ?? 0;
    return {
      ref: (node: HTMLButtonElement | null) => {
        optionRefs.current[index] = node;
      },
      type: "button" as const,
      // Focus is moved programmatically, so Tab leaves the popup instead of
      // walking through every entry in it.
      tabIndex: -1,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) =>
        onOptionKeyDown(event, index),
    };
  };

  return (
    <div ref={wrapperRef} className="relative">
      <label
        id={labelId}
        className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}
      </label>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-labelledby={labelId}
        className={cn(
          "block w-full rounded-md border px-3 py-2 text-left text-sm shadow-sm",
          "bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100",
          "focus:outline-none focus:ring-2 focus:ring-blue-500",
          "disabled:cursor-not-allowed disabled:opacity-60",
          error
            ? "border-red-500 dark:border-red-500"
            : "border-gray-300 dark:border-gray-600",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "truncate",
              !selected && "text-gray-400 dark:text-gray-400",
            )}
          >
            {selected
              ? t("gem.settingsForm.instrumentOption", {
                  symbol: selected.symbol,
                  name: selected.name,
                })
              : t("gem.settingsForm.noInstrument")}
          </span>
          <svg
            className={cn(
              "h-5 w-5 shrink-0 text-gray-400 transition-transform",
              isOpen && "rotate-180",
            )}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          className={cn(
            "absolute z-20 mt-1 w-full rounded-md bg-white shadow-lg dark:bg-gray-800 dark:shadow-gray-700/50",
            "ring-1 ring-black/5 dark:ring-gray-600",
            "scrollbar-slim max-h-80 overflow-y-auto py-1",
          )}
        >
          {offered.length > 0 && (
            <>
              <p className="px-3 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("gem.settingsForm.suggestedHeading")}
              </p>
              {GEM_SUGGESTION_REGIONS.map((region) => {
                const inRegion = rows.filter(
                  (row): row is Extract<Row, { kind: "suggestion" }> =>
                    row.kind === "suggestion" &&
                    row.suggestion.region === region,
                );
                if (inRegion.length === 0) return null;
                return (
                  <div key={region}>
                    <p className="px-3 py-1 text-xs text-gray-400 dark:text-gray-500">
                      {regionLabel(region)}
                    </p>
                    {inRegion.map((row) => {
                      const { suggestion, owned } = row;
                      return (
                        <button
                          key={row.key}
                          {...optionProps(row)}
                          role="option"
                          aria-selected={owned ? owned.id === value : false}
                          onClick={() => activate(row)}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                            "hover:bg-gray-100 dark:hover:bg-gray-700",
                            "focus:bg-gray-100 focus:outline-none dark:focus:bg-gray-700",
                            owned?.id === value &&
                              "bg-gray-50 dark:bg-gray-700/50",
                          )}
                        >
                          {owned ? (
                            <CheckIcon
                              className={cn(
                                "h-4 w-4 shrink-0",
                                owned.id === value
                                  ? "text-blue-600 dark:text-blue-400"
                                  : "text-gray-400",
                              )}
                              aria-hidden="true"
                            />
                          ) : (
                            <PlusIcon
                              className="h-4 w-4 shrink-0 text-gray-400"
                              aria-hidden="true"
                            />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-gray-900 dark:text-gray-100">
                              {owned ? owned.symbol : suggestion.symbol}
                            </span>
                            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                              {owned
                                ? t("gem.settingsForm.suggestedOwned", {
                                    name: owned.name,
                                  })
                                : t("gem.settingsForm.suggestedListing", {
                                    name: suggestion.name,
                                    exchange: suggestion.exchange ?? "",
                                  })}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
            </>
          )}

          <p className="px-3 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("gem.settingsForm.ownedHeading")}
          </p>
          {rows
            .filter((row) => row.kind === "none")
            .map((row) => (
              <button
                key={row.key}
                {...optionProps(row)}
                role="option"
                aria-selected={value === ""}
                onClick={() => activate(row)}
                className={cn(
                  "block w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700",
                  "focus:bg-gray-100 focus:outline-none dark:focus:bg-gray-700",
                  value === ""
                    ? "font-medium text-gray-900 dark:text-gray-100"
                    : "text-gray-600 dark:text-gray-300",
                )}
              >
                {t("gem.settingsForm.noInstrument")}
              </button>
            ))}
          {rows
            .filter(
              (row): row is Extract<Row, { kind: "security" }> =>
                row.kind === "security",
            )
            .map((row) => (
              <button
                key={row.key}
                {...optionProps(row)}
                role="option"
                aria-selected={row.security.id === value}
                onClick={() => activate(row)}
                className={cn(
                  "block w-full truncate px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700",
                  "focus:bg-gray-100 focus:outline-none dark:focus:bg-gray-700",
                  row.security.id === value
                    ? "font-medium text-gray-900 dark:text-gray-100"
                    : "text-gray-600 dark:text-gray-300",
                )}
              >
                {t("gem.settingsForm.instrumentOption", {
                  symbol: row.security.symbol,
                  name: row.security.name,
                })}
              </button>
            ))}
        </div>
      )}

      {error && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
