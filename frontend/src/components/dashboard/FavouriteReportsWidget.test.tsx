import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/render';
import { FavouriteReportsWidget } from './FavouriteReportsWidget';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

let mockPreferences: { favouriteReportIds: string[] } | null = null;
vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: (selector: (state: unknown) => unknown) =>
    selector({ preferences: mockPreferences }),
}));

describe('FavouriteReportsWidget', () => {
  beforeEach(() => {
    pushMock.mockReset();
    mockPreferences = null;
  });

  it('renders favourite reports as one-click links with the report icon', () => {
    mockPreferences = { favouriteReportIds: ['spending-by-category', 'net-worth'] };
    const { container } = render(<FavouriteReportsWidget />);

    expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    expect(screen.getByText('Net Worth Over Time')).toBeInTheDocument();

    // Each favourite shows its catalog icon (an inline SVG), one per report.
    const listIcons = container.querySelectorAll('ul li svg');
    expect(listIcons.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByText('Spending by Category'));
    expect(pushMock).toHaveBeenCalledWith('/reports/spending-by-category');
  });

  it('renders the empty state with a link to the reports page', () => {
    mockPreferences = { favouriteReportIds: [] };
    render(<FavouriteReportsWidget />);

    expect(screen.getByText(/No favourite reports yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reports page'));
    expect(pushMock).toHaveBeenCalledWith('/reports');
  });

  it('ignores ids that no longer map to a known report', () => {
    mockPreferences = { favouriteReportIds: ['not-a-real-report'] };
    render(<FavouriteReportsWidget />);
    // Falls back to the empty state rather than rendering a broken link.
    expect(screen.getByText(/No favourite reports yet/)).toBeInTheDocument();
  });

  it('shows a skeleton while loading without listing reports', () => {
    mockPreferences = { favouriteReportIds: ['spending-by-category'] };
    render(<FavouriteReportsWidget isLoading />);
    expect(screen.getByText('Favourite Reports')).toBeInTheDocument();
    expect(screen.queryByText('Spending by Category')).not.toBeInTheDocument();
  });
});
