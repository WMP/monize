import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/render';
import { BudgetFxIncompleteError } from '@/lib/budget-partial';
import { useAuthStore } from '@/store/authStore';
import { ReportError } from './ReportError';

describe('ReportError', () => {
  it('renders a default message', () => {
    render(<ReportError />);
    expect(screen.getByText(/failed to load report data/i)).toBeInTheDocument();
  });

  it('renders a custom message', () => {
    render(<ReportError message="Custom failure" />);
    expect(screen.getByText('Custom failure')).toBeInTheDocument();
  });

  it('omits the retry button when no handler is given', () => {
    render(<ReportError />);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ReportError onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

const partial = {
  fxComplete: false as const, total: null, result: null, currency: 'EUR',
  knownComponents: [{ id: 'known', currency: 'EUR', date: '2026-10-31', knownSubtotal: -80 }],
  missingRatePairs: [{ from: 'USD', to: 'EUR', date: '2026-10-31', reason: null }],
  repair: 'currency_rate_history' as const, fetchAttempted: false as const,
};

describe('partial budget results', () => {
  it('shows known components, a rate repair link and retry without a score or zero budget', () => {
    const onRetry = vi.fn();
    render(<ReportError error={new BudgetFxIncompleteError(partial)} onRetry={onRetry} />);
    expect(screen.getByTestId('budget-fx-partial')).toHaveTextContent('USD → EUR');
    expect(screen.getByTestId('budget-fx-partial')).toHaveTextContent('-€80.00');
    expect(screen.getByRole('link', { name: /currencies/i })).toHaveAttribute('href', '/currencies');
    expect(screen.queryByText(/health score/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
  it('does not offer owner currency settings to a delegate', () => {
    useAuthStore.setState({ actingAsUserId: 'owner' });
    try {
      render(<ReportError error={new BudgetFxIncompleteError(partial)} />);
      expect(screen.queryByRole('link', { name: /currencies/i })).not.toBeInTheDocument();
    } finally {
      // Unmount before resetting the store: a live subscriber re-rendering
      // from this reset, rather than from a user event, is what the act()
      // guard caught here.
      cleanup();
      useAuthStore.setState({ actingAsUserId: null });
    }
  });
});
