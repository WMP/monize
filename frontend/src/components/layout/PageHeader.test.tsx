import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="My Page" />);
    expect(screen.getByRole('heading', { name: 'My Page' })).toBeInTheDocument();
  });

  it('renders the subtitle when provided', () => {
    render(<PageHeader title="My Page" subtitle="A helpful description" />);
    expect(screen.getByText('A helpful description')).toBeInTheDocument();
  });

  it('does not render subtitle when not provided', () => {
    render(<PageHeader title="My Page" />);
    expect(screen.queryByText('A helpful description')).not.toBeInTheDocument();
  });

  it('renders action buttons when provided', () => {
    render(
      <PageHeader
        title="My Page"
        actions={<button>Add New</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add New' })).toBeInTheDocument();
  });

  it('does not render actions container when no actions provided', () => {
    const { container } = render(<PageHeader title="My Page" />);
    // No flex-wrap actions container should exist
    const actionsContainer = container.querySelector('.flex.flex-wrap');
    expect(actionsContainer).toBeNull();
  });

  it('renders help link when helpUrl is provided', () => {
    render(<PageHeader title="My Page" helpUrl="https://example.com/help" />);
    const helpLink = screen.getByRole('link', { name: /Open the Monize wiki/i });
    expect(helpLink).toBeInTheDocument();
  });

  it('help link has correct href, target, and rel attributes', () => {
    render(<PageHeader title="My Page" helpUrl="https://example.com/help" />);
    const helpLink = screen.getByRole('link', { name: /Open the Monize wiki/i });
    expect(helpLink).toHaveAttribute('href', 'https://example.com/help');
    expect(helpLink).toHaveAttribute('target', '_blank');
    expect(helpLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not render help link when helpUrl is omitted', () => {
    render(<PageHeader title="My Page" />);
    expect(screen.queryByRole('link', { name: /Open the Monize wiki/i })).not.toBeInTheDocument();
  });

  it('shows a tooltip describing the wiki destination', () => {
    render(<PageHeader title="My Page" helpUrl="https://example.com/help" />);
    expect(
      screen.getByRole('tooltip', { name: /Open the Monize wiki/i }),
    ).toBeInTheDocument();
  });

  it('renders help link alongside action buttons when both are provided', () => {
    render(
      <PageHeader
        title="My Page"
        helpUrl="https://example.com/help"
        actions={<button>Add New</button>}
      />,
    );
    expect(screen.getByRole('link', { name: /Open the Monize wiki/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add New' })).toBeInTheDocument();
  });

  it('renders help link next to title when no other actions are provided', () => {
    const { container } = render(
      <PageHeader title="My Page" helpUrl="https://example.com/help" />,
    );
    expect(screen.getByRole('link', { name: /Open the Monize wiki/i })).toBeInTheDocument();
    // No actions container should exist when only helpUrl is provided
    const actionsContainer = container.querySelector('.flex.flex-wrap');
    expect(actionsContainer).toBeNull();
  });
});
