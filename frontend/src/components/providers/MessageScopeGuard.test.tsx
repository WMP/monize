import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';
import { MessageScopeGuard } from './MessageScopeGuard';

const refresh = vi.fn();
let pathname = '/login';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh }),
}));

describe('MessageScopeGuard', () => {
  beforeEach(() => {
    refresh.mockClear();
    pathname = '/login';
  });

  it('renders a public page under the public catalog', () => {
    render(
      <MessageScopeGuard scope="public">
        <p>app</p>
      </MessageScopeGuard>,
    );
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('holds the app back and refreshes when a sign-in navigates out of the public pages', () => {
    const { rerender } = render(
      <MessageScopeGuard scope="public">
        <p>app</p>
      </MessageScopeGuard>,
    );

    pathname = '/dashboard';
    rerender(
      <MessageScopeGuard scope="public">
        <p>app</p>
      </MessageScopeGuard>,
    );
    expect(screen.queryByText('app')).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);

    // The refresh re-renders the root layout for /dashboard with every catalog.
    rerender(
      <MessageScopeGuard scope="full">
        <p>app</p>
      </MessageScopeGuard>,
    );
    expect(screen.getByText('app')).toBeInTheDocument();
  });

  it('lets a public-to-public navigation through without a refresh', () => {
    const { rerender } = render(
      <MessageScopeGuard scope="public">
        <p>app</p>
      </MessageScopeGuard>,
    );
    pathname = '/register';
    rerender(
      <MessageScopeGuard scope="public">
        <p>app</p>
      </MessageScopeGuard>,
    );
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('renders the page it landed on even when that path is not public', () => {
    // The not-found page for a dotted path the proxy never saw.
    pathname = '/missing.txt';
    render(
      <MessageScopeGuard scope="public">
        <p>not found</p>
      </MessageScopeGuard>,
    );
    expect(screen.getByText('not found')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('never refreshes under the full catalog', () => {
    pathname = '/dashboard';
    const { rerender } = render(
      <MessageScopeGuard scope="full">
        <p>app</p>
      </MessageScopeGuard>,
    );
    pathname = '/login';
    rerender(
      <MessageScopeGuard scope="full">
        <p>app</p>
      </MessageScopeGuard>,
    );
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
