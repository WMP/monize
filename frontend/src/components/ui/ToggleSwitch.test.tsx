import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/render';
import { ToggleSwitch } from './ToggleSwitch';

describe('ToggleSwitch', () => {
  it('renders with role="switch" and the right aria-checked', () => {
    render(<ToggleSwitch checked onChange={() => {}} label="Enable feature" />);
    const sw = screen.getByRole('switch', { name: 'Enable feature' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('reflects unchecked state via aria-checked="false"', () => {
    render(<ToggleSwitch checked={false} onChange={() => {}} label="Off" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with the inverted value when clicked', () => {
    const onChange = vi.fn();
    render(<ToggleSwitch checked={false} onChange={onChange} label="Toggle me" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange with false when clicked while checked', () => {
    const onChange = vi.fn();
    render(<ToggleSwitch checked onChange={onChange} label="Toggle me" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn();
    render(
      <ToggleSwitch checked={false} onChange={onChange} disabled label="Off" />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a small variant when size="sm"', () => {
    render(
      <ToggleSwitch checked onChange={() => {}} size="sm" label="Small" />,
    );
    const sw = screen.getByRole('switch');
    // sm preset uses h-4 w-7; md uses h-5 w-9. Check via class presence.
    expect(sw.className).toMatch(/h-4/);
    expect(sw.className).toMatch(/w-7/);
  });
  it('takes its accessible name from visible text via labelledBy', () => {
    // A switch with text beside it must not also carry an aria-label: screen
    // readers would announce the name twice.
    render(
      <>
        <ToggleSwitch checked onChange={() => {}} labelledBy="deduct-label" />
        <span id="deduct-label">Deduct withholding tax already taken at source</span>
      </>,
    );

    const sw = screen.getByRole('switch');
    expect(sw).not.toHaveAttribute('aria-label');
    expect(sw).toHaveAttribute('aria-labelledby', 'deduct-label');
    expect(sw).toHaveAccessibleName('Deduct withholding tax already taken at source');
  });

  it('lets labelledBy win over a label passed alongside it', () => {
    render(
      <>
        <ToggleSwitch checked onChange={() => {}} label="Ignored" labelledBy="visible" />
        <span id="visible">Visible name</span>
      </>,
    );

    const sw = screen.getByRole('switch');
    expect(sw).not.toHaveAttribute('aria-label');
    expect(sw).toHaveAccessibleName('Visible name');
  });
});
