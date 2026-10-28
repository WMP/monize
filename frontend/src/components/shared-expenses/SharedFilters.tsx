"use client";

import { useState, type ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FilterPanelHeader } from "@/components/ui/FilterPanelHeader";

export interface SharedFilterChip {
  key: string;
  label: string;
  removeLabel: string;
  remove: () => void;
}

export function SharedFilters({
  chips,
  onClear,
  children,
}: {
  chips: SharedFilterChip[];
  onClear: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <Card>
      <div className="px-4 py-3 sm:px-6">
        <FilterPanelHeader
          expanded={expanded}
          count={chips.length}
          onToggle={() => setExpanded(!expanded)}
          onClear={onClear}
        />
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {chips.map((chip) => (
              <Badge
                key={chip.key}
                variant="blue"
                className="max-w-full whitespace-normal"
              >
                <span className="inline-flex items-center gap-1 max-w-full break-words">
                  {chip.label}
                  <button
                    type="button"
                    onClick={chip.remove}
                    aria-label={chip.removeLabel}
                    className="shrink-0 p-1 rounded focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </span>
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div
        hidden={!expanded}
        className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 sm:px-6"
      >
        {children}
      </div>
    </Card>
  );
}
