import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@/test/render';
import { ScenarioComparisonChart, ScenarioOutcome } from './ScenarioComparisonChart';

// Recharts needs a real layout; stub it so the chart renders deterministically
// in jsdom. Lines expose their legend name so the arcs are countable.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: ({ name }: { name: string }) => <div data-testid="chart-line">{name}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: ({ content }: { content: (props: unknown) => ReactNode }) => (
    <div data-testid="tooltip">
      {content({
        active: true,
        payload: [{ dataKey: 's1' }, { dataKey: 'baseline' }],
        label: 'Jan 2028',
      })}
      {content({ active: false, payload: [], label: '' })}
    </div>
  ),
}));

const outcomes: ScenarioOutcome[] = [
  {
    id: 's1',
    name: 'Aggressive',
    recurringExtra: 1500,
    lumpSumCount: 0,
    interestSaved: 30000,
    payoffDate: '2030-06-15',
  },
  {
    id: 's2',
    name: 'Moderate',
    recurringExtra: 500,
    lumpSumCount: 2,
    interestSaved: 15000,
    payoffDate: '2035-03-15',
  },
];

const baseline = { payoffDate: '2040-01-15' };

describe('ScenarioComparisonChart', () => {
  it('draws a baseline marker and an arc per scenario, named with the overpayment', () => {
    render(
      <ScenarioComparisonChart
        outcomes={outcomes}
        baseline={baseline}
        currencyCode="PLN"
      />,
    );

    const lines = screen.getAllByTestId('chart-line');
    // Baseline zero-line + one parabola per scenario
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.textContent).join('|')).toMatch(/No overpayments/);
    expect(screen.getByText(/Aggressive · \+.*1,500.*\/ payment/)).toBeInTheDocument();
    expect(
      screen.getByText(/Moderate · \+.*500.*\/ payment \+ 2 lump sums/),
    ).toBeInTheDocument();
  });

  it('shows the real interest saved and payoff date in the tooltip', () => {
    render(
      <ScenarioComparisonChart
        outcomes={outcomes}
        baseline={baseline}
        currencyCode="PLN"
      />,
    );

    // The tooltip lists only the hovered series (s1) with its true figures,
    // not the interpolated arc height.
    const tooltip = screen.getByTestId('tooltip');
    expect(tooltip).toHaveTextContent(/Aggressive/);
    expect(tooltip).toHaveTextContent(/30,000/);
    expect(tooltip).toHaveTextContent('Jun 2030');
    expect(tooltip).not.toHaveTextContent(/Moderate/);
  });

  it('labels a scenario that never pays off within the projection', () => {
    render(
      <ScenarioComparisonChart
        outcomes={[{ ...outcomes[0], payoffDate: null }]}
        baseline={baseline}
        currencyCode="PLN"
      />,
    );

    expect(screen.getByTestId('tooltip')).toHaveTextContent('Beyond projection');
  });
});
