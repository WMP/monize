import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import { CurrencyForm } from './CurrencyForm';
import toast from 'react-hot-toast';

vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => async () => ({ values: {}, errors: {} }),
}));

const mockLookupCurrency = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/exchange-rates', () => ({
  exchangeRatesApi: {
    lookupCurrency: (...args: any[]) => mockLookupCurrency(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe('CurrencyForm', () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLookupCurrency.mockResolvedValue(null);
  });

  it('renders create form fields', () => {
    render(<CurrencyForm onSubmit={onSubmit} onCancel={onCancel} />);
    expect(screen.getByText('Currency Code')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Symbol')).toBeInTheDocument();
    expect(screen.getByText('Decimal Places')).toBeInTheDocument();
  });

  it('shows Create Currency button for new form', () => {
    render(<CurrencyForm onSubmit={onSubmit} onCancel={onCancel} />);
    expect(screen.getByText('Create Currency')).toBeInTheDocument();
  });

  it('shows Update Currency button when editing', () => {
    const currency = {
      code: 'USD',
      name: 'US Dollar',
      symbol: '$',
      decimalPlaces: 2,
      isActive: true,
      isSystem: false,
      createdAt: '2025-01-01T00:00:00Z',
    } as any;
    render(<CurrencyForm currency={currency} onSubmit={onSubmit} onCancel={onCancel} />);
    expect(screen.getByText('Update Currency')).toBeInTheDocument();
  });

  it('shows Lookup button in create mode', () => {
    render(<CurrencyForm onSubmit={onSubmit} onCancel={onCancel} />);
    expect(screen.getByText('Lookup')).toBeInTheDocument();
  });

  it('hides Lookup button when editing', () => {
    const currency = {
      code: 'EUR',
      name: 'Euro',
      symbol: '\u20ac',
      decimalPlaces: 2,
      isActive: true,
      isSystem: true,
      createdAt: '2025-01-01T00:00:00Z',
    } as any;
    render(<CurrencyForm currency={currency} onSubmit={onSubmit} onCancel={onCancel} />);
    expect(screen.queryByText('Lookup')).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel is clicked', () => {
    render(<CurrencyForm onSubmit={onSubmit} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables currency code input when editing', () => {
    const currency = {
      code: 'CAD',
      name: 'Canadian Dollar',
      symbol: '$',
      decimalPlaces: 2,
      isActive: true,
      isSystem: true,
      createdAt: '2025-01-01T00:00:00Z',
    } as any;
    render(<CurrencyForm currency={currency} onSubmit={onSubmit} onCancel={onCancel} />);
    const codeInput = screen.getByDisplayValue('CAD');
    expect(codeInput).toBeDisabled();
  });

  it('shows error toast when Lookup clicked with empty fields', async () => {
    render(<CurrencyForm onSubmit={onSubmit} onCancel={onCancel} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Lookup'));
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('at least 2 characters'));
  });

  it('uses name field when code is too short', async () => {
    render(<CurrencyForm onSubmit={onSubmit} onCancel={onCancel} />);
    const nameInput = screen.getByPlaceholderText(/Canadian Dollar, Malaysia/);
    fireEvent.change(nameInput, { target: { value: 'US' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Lookup'));
    });
    expect(mockLookupCurrency).toHaveBeenCalledWith('US');
  });

  it('shows not found toast when lookup returns null', async () => {
    mockLookupCurrency.mockResolvedValue(null);
    render(<CurrencyForm onSubmit={onSubmit} onCancel={onCancel} />);
    const codeInput = screen.getByPlaceholderText(/USD, EUR, GBP/);
    fireEvent.change(codeInput, { target: { value: 'XYZ' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Lookup'));
    });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('No currency found'));
    });
  });

  it('fills form fields and shows Clear button when lookup succeeds', async () => {
    mockLookupCurrency.mockResolvedValue({ code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimalPlaces: 2 });
    render(<CurrencyForm onSubmit={onSubmit} onCancel={onCancel} />);
    const codeInput = screen.getByPlaceholderText(/USD, EUR, GBP/);
    fireEvent.change(codeInput, { target: { value: 'CAD' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Lookup'));
    });
    await waitFor(() => {
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('CAD'));
  });

  it('clears form fields when Clear is clicked', async () => {
    mockLookupCurrency.mockResolvedValue({ code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimalPlaces: 2 });
    render(<CurrencyForm onSubmit={onSubmit} onCancel={onCancel} />);
    const codeInput = screen.getByPlaceholderText(/USD, EUR, GBP/);
    fireEvent.change(codeInput, { target: { value: 'CAD' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Lookup'));
    });
    await waitFor(() => expect(screen.getByText('Clear')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText('Clear'));
    });
    await waitFor(() => expect(screen.queryByText('Clear')).not.toBeInTheDocument());
  });

  it('shows error toast when lookup throws', async () => {
    mockLookupCurrency.mockRejectedValue(new Error('Network error'));
    render(<CurrencyForm onSubmit={onSubmit} onCancel={onCancel} />);
    const codeInput = screen.getByPlaceholderText(/USD, EUR, GBP/);
    fireEvent.change(codeInput, { target: { value: 'CAD' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Lookup'));
    });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Lookup failed - please try again');
    });
  });
});
