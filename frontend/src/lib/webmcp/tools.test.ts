import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAccountsGetAll = vi.fn();
const mockCategoriesGetAll = vi.fn();
const mockCategoriesDelete = vi.fn();
const mockTransactionsCreate = vi.fn();

vi.mock('@/lib/accounts', () => ({
  accountsApi: { getAll: (...a: unknown[]) => mockAccountsGetAll(...a) },
}));
vi.mock('@/lib/categories', () => ({
  categoriesApi: {
    getAll: (...a: unknown[]) => mockCategoriesGetAll(...a),
    delete: (...a: unknown[]) => mockCategoriesDelete(...a),
  },
}));
vi.mock('@/lib/payees', () => ({ payeesApi: {} }));
vi.mock('@/lib/transactions', () => ({
  transactionsApi: { create: (...a: unknown[]) => mockTransactionsCreate(...a) },
}));
vi.mock('@/lib/budgets', () => ({ budgetsApi: {} }));
vi.mock('@/lib/built-in-reports', () => ({ builtInReportsApi: {} }));
vi.mock('@/lib/errors', () => ({
  getErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

import { webMcpTools } from './tools';

describe('webMcpTools registry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has unique tool names and valid object schemas', () => {
    const names = webMcpTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of webMcpTools) {
      expect(tool.name).toMatch(/^monize_/);
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('wraps a read result as text content', async () => {
    mockCategoriesGetAll.mockResolvedValue([{ id: 'c1', name: 'Food' }]);
    const tool = webMcpTools.find((t) => t.name === 'monize_list_categories')!;
    const result = await tool.execute({});
    expect(mockCategoriesGetAll).toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Food');
  });

  it('passes through create arguments', async () => {
    mockTransactionsCreate.mockResolvedValue({ id: 't1' });
    const tool = webMcpTools.find((t) => t.name === 'monize_create_transaction')!;
    await tool.execute({ accountId: 'a1', amount: -10, transactionDate: '2026-01-01' });
    expect(mockTransactionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'a1', amount: -10, transactionDate: '2026-01-01' }),
    );
  });

  it('returns an isError result when the underlying API throws', async () => {
    mockCategoriesGetAll.mockRejectedValue(new Error('boom'));
    const tool = webMcpTools.find((t) => t.name === 'monize_list_categories')!;
    const result = await tool.execute({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBeTruthy();
  });

  it('reports deletion as a structured result', async () => {
    mockCategoriesDelete.mockResolvedValue(undefined);
    const tool = webMcpTools.find((t) => t.name === 'monize_delete_category')!;
    const result = await tool.execute({ id: 'c9' });
    expect(mockCategoriesDelete).toHaveBeenCalledWith('c9');
    expect(result.content[0].text).toContain('c9');
  });
});
