import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/render';

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/settings/TourCatalog', () => ({
  TourCatalog: () => <div data-testid="tour-catalog" />,
}));

import ToursSettingsPage from './page';

afterEach(() => cleanup());

describe('Tours settings page', () => {
  it('renders the catalog under a titled header', () => {
    render(<ToursSettingsPage />);

    expect(
      screen.getByRole('heading', { name: 'Guided tours' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('tour-catalog')).toBeInTheDocument();
  });

  it('links back to Settings', () => {
    render(<ToursSettingsPage />);

    const back = screen.getByRole('link', { name: /Back to Settings/ });
    expect(back).toHaveAttribute('href', '/settings');
  });
});
