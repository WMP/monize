import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@/test/render';
import { ScenarioComparisonChart, ScenarioOutcome } from './ScenarioComparisonChart';

// Recharts needs a real layout; stub it so the chart renders deterministically
// in jsdom. Cell is rendered as a marker so we can count bars.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Bar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Cell: () => <span data-testid="bar-cell" />,
  LabelList: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

vi.mock('@/components/reports/ChartTooltip', () => ({ ChartTooltip: () => null }));

const outcomes: ScenarioOutcome[] = [
  { id: '__baseline__', name: 'No overpayment', totalInterest: 50000, payoffDate: '2040-01-15', isBaseline: true },
  { id: 's1', name: 'Aggressive', totalInterest: 20000, payoffDate: '2030-06-15' },
  { id: 's2', name: 'Moderate', totalInterest: 35000, payoffDate: '2035-03-15' },
];

describe('ScenarioComparisonChart', () => {
  it('renders a titled comparison with one bar per outcome', () => {
    render(<ScenarioComparisonChart outcomes={outcomes} currencyCode="PLN" />);

    expect(screen.getByText('Scenario comparison')).toBeInTheDocument();
    expect(screen.getAllByTestId('bar-cell')).toHaveLength(3);
  });
});
