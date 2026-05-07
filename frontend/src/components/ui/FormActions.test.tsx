import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { FormActions } from './FormActions';

describe('FormActions', () => {
  it('renders Cancel and Save buttons when onCancel is provided', () => {
    const onCancel = vi.fn();
    render(<FormActions onCancel={onCancel} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('does not render Cancel button when onCancel is not provided', () => {
    render(<FormActions />);
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<FormActions onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('uses custom submitLabel', () => {
    render(<FormActions submitLabel="Create Account" />);
    expect(screen.getByText('Create Account')).toBeInTheDocument();
  });

  it('disables Cancel when isSubmitting is true', () => {
    const onCancel = vi.fn();
    render(<FormActions onCancel={onCancel} isSubmitting={true} />);
    expect(screen.getByText('Cancel').closest('button')).toBeDisabled();
  });

  it('disables submit button when submitDisabled is true', () => {
    render(<FormActions submitDisabled={true} />);
    expect(screen.getByText('Save').closest('button')).toBeDisabled();
  });

  it('applies custom className', () => {
    const { container } = render(<FormActions className="custom-class" />);
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });
});
