'use client';

import { cn } from '@/lib/utils';

type ChartView = 'pie' | 'bar' | 'line' | 'area' | 'table';

interface ChartViewToggleProps {
  value: ChartView;
  onChange: (view: ChartView) => void;
  options?: ChartView[];
  activeColour?: string;
  className?: string;
}

const CHART_ICONS: Record<ChartView, { title: string; path: string }> = {
  pie: {
    title: 'Pie Chart',
    path: 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z',
  },
  bar: {
    title: 'Bar Chart',
    path: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  line: {
    title: 'Line Chart',
    path: 'M3 17l4-4 4 4 4-8 4 4',
  },
  area: {
    title: 'Area Chart',
    path: 'M3 17l4-4 4 4 4-8 4 4V21H3z',
  },
  table: {
    title: 'Table',
    path: 'M3 10h18M3 14h18M3 6h18M3 18h18',
  },
};

export function ChartViewToggle({
  value,
  onChange,
  options = ['pie', 'bar'],
  activeColour = 'bg-blue-600',
  className,
}: ChartViewToggleProps) {
  const inactiveClasses = 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300';

  return (
    <div className={cn('flex gap-2', className)}>
      {options.map((view) => {
        const icon = CHART_ICONS[view];
        return (
          <button
            key={view}
            onClick={() => onChange(view)}
            className={cn(
              'p-2 rounded-md transition-colors',
              value === view ? `${activeColour} text-white` : inactiveClasses
            )}
            title={icon.title}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon.path} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
