import { transactionsApi } from '@/lib/transactions';
import { defineTool, type WebMcpTool } from '../types';

export const transactionTools: WebMcpTool[] = [
  defineTool(
    'monize_list_transactions',
    'List transactions (paginated). Optional filters: accountId, categoryId, payeeId, startDate/endDate (YYYY-MM-DD), search, page, limit.',
    {
      type: 'object',
      properties: {
        accountId: { type: 'string' },
        categoryId: { type: 'string' },
        payeeId: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        search: { type: 'string' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
      },
    },
     
    (args) => transactionsApi.getAll(args as any),
  ),
  defineTool(
    'monize_get_transaction',
    'Get a single transaction by id.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    (args) => transactionsApi.getById(String(args.id)),
  ),
  defineTool(
    'monize_get_transaction_summary',
    'Get aggregate transaction totals (income, expenses, net) for an optional date range / account.',
    {
      type: 'object',
      properties: {
        accountId: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
      },
    },
     
    (args) => transactionsApi.getSummary(args as any),
  ),
  defineTool(
    'monize_create_transaction',
    'Create a transaction. Required: accountId, amount (negative for an expense, positive for income), transactionDate (YYYY-MM-DD). Optional: payeeId or payeeName, categoryId, description.',
    {
      type: 'object',
      properties: {
        accountId: { type: 'string' },
        amount: { type: 'number' },
        transactionDate: { type: 'string' },
        payeeId: { type: 'string' },
        payeeName: { type: 'string' },
        categoryId: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['accountId', 'amount', 'transactionDate'],
    },
     
    (args) => transactionsApi.create(args as any),
  ),
  defineTool(
    'monize_update_transaction',
    'Update a transaction by id. Pass only the fields to change (amount, transactionDate, payeeId, categoryId, description).',
    {
      type: 'object',
      properties: {
        id: { type: 'string' },
        amount: { type: 'number' },
        transactionDate: { type: 'string' },
        payeeId: { type: 'string' },
        categoryId: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['id'],
    },
    (args) => {
      const { id, ...data } = args;
       
      return transactionsApi.update(String(id), data as any);
    },
  ),
  defineTool(
    'monize_delete_transaction',
    'Delete a transaction by id.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async (args) => {
      await transactionsApi.delete(String(args.id));
      return { deleted: true, id: args.id };
    },
  ),
];
