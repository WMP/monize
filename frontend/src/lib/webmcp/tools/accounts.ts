import { accountsApi } from '@/lib/accounts';
import { defineTool, EMPTY_SCHEMA, type WebMcpTool } from '../types';

export const accountTools: WebMcpTool[] = [
  defineTool(
    'monize_list_accounts',
    'List the user\'s accounts with balances. By default only active accounts; pass includeInactive=true to include closed ones.',
    {
      type: 'object',
      properties: { includeInactive: { type: 'boolean' } },
    },
    (args) => accountsApi.getAll(args.includeInactive === true),
  ),
  defineTool(
    'monize_get_account',
    'Get a single account by id.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    (args) => accountsApi.getById(String(args.id)),
  ),
  defineTool(
    'monize_get_account_summary',
    'Get aggregate account totals (assets, liabilities, net worth).',
    EMPTY_SCHEMA,
    () => accountsApi.getSummary(),
  ),
  defineTool(
    'monize_create_account',
    'Create an account. Provide name, type (e.g. CHEQUING, SAVINGS, CREDIT_CARD, CASH, ASSET), currencyCode and optional openingBalance.',
    {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        currencyCode: { type: 'string' },
        openingBalance: { type: 'number' },
      },
      required: ['name', 'type'],
    },
     
    (args) => accountsApi.create(args as any),
  ),
  defineTool(
    'monize_update_account',
    'Update an account by id. Pass only the fields to change.',
    {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        currencyCode: { type: 'string' },
      },
      required: ['id'],
    },
    (args) => {
      const { id, ...data } = args;
       
      return accountsApi.update(String(id), data as any);
    },
  ),
  defineTool(
    'monize_close_account',
    'Close (deactivate) an account by id without deleting its history.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    (args) => accountsApi.close(String(args.id)),
  ),
  defineTool(
    'monize_reopen_account',
    'Reopen a previously closed account by id.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    (args) => accountsApi.reopen(String(args.id)),
  ),
  defineTool(
    'monize_delete_account',
    'Permanently delete an account by id. Only possible when it has no transactions; call monize_get_account first if unsure.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async (args) => {
      await accountsApi.delete(String(args.id));
      return { deleted: true, id: args.id };
    },
  ),
];
