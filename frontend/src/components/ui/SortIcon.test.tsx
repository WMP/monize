import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';
import { SortIcon } from './SortIcon';

describe('SortIcon', () => {
  it('shows unsorted indicator when field does not match sortField', () => {
    render(<SortIcon field="name" sortField="date" sortDirection="asc" />);
    expect(screen.getByText('↕')).toBeInTheDocument();
  });

  it('shows ascending indicator when field matches and direction is asc', () => {
    render(<SortIcon field="name" sortField="name" sortDirection="asc" />);
    expect(screen.getByText('↑')).toBeInTheDocument();
  });

  it('shows descending indicator when field matches and direction is desc', () => {
    render(<SortIcon field="name" sortField="name" sortDirection="desc" />);
    expect(screen.getByText('↓')).toBeInTheDocument();
  });
});
