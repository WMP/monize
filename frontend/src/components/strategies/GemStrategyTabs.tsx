"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabItem } from "@/components/ui/Tabs";
import { TOUR_ANCHORS, tourAnchor } from "@/lib/tours/anchors";

export const GEM_TABS = [
  "overview",
  "signals",
  "portfolio",
  "backtest",
  "settings",
] as const;

export type GemTab = (typeof GEM_TABS)[number];

/**
 * Namespace for the tab and panel ids. `tabId`/`tabPanelId` build
 * `gem-tab-<key>` and `gem-panel-<key>` from it, which is what the report's
 * panels point back at.
 */
export const GEM_TABS_ID_PREFIX = "gem";

interface GemStrategyTabsProps {
  active: GemTab;
  onChange: (tab: GemTab) => void;
}

/**
 * Tab bar for the strategy page: the shared `ui/Tabs`, not a second tablist.
 *
 * This was hand-rolled, and re-grew the defect the shared component documents a
 * fix for -- it set `aria-controls` on every tab while only the selected tab's
 * panel is in the DOM, so four of the five pointed at an element that was not
 * there. The keyboard behaviour, the roving tabindex, the horizontal scroll and
 * the id conventions all live in one place now; this file supplies the labels
 * and the negative gutters that let the row bleed to the screen edge on mobile.
 */
export function GemStrategyTabs({ active, onChange }: GemStrategyTabsProps) {
  const t = useTranslations("strategies");
  const tabs = useMemo<TabItem<GemTab>[]>(
    () =>
      GEM_TABS.map((tab) => ({
        key: tab,
        label: t(`gem.tabs.${tab}` as Parameters<typeof t>[0]),
      })),
    [t],
  );

  return (
    <Tabs
      tabs={tabs}
      value={active}
      onChange={onChange}
      idPrefix={GEM_TABS_ID_PREFIX}
      ariaLabel={t("gem.tabs.ariaLabel")}
      className="-mx-4 mb-4 px-4 sm:mx-0 sm:px-0"
      // The tour rings the tab row itself, so the anchor goes on the tablist
      // rather than on a wrapper: a wrapper would be full-bleed on mobile,
      // where this row deliberately runs to the screen edge.
      anchorProps={tourAnchor(TOUR_ANCHORS.gemStrategyTabs)}
    />
  );
}
