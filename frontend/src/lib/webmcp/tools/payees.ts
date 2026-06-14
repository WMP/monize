import { payeesApi } from '@/lib/payees';
import { defineTool, type WebMcpTool } from '../types';

export const payeeTools: WebMcpTool[] = [
  defineTool(
    'monize_list_payees',
    'List payees. Optional status filter: "active" (default), "inactive" or "all".',
    {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive', 'all'] },
      },
    },
     
    (args) => payeesApi.getAll((args.status as any) ?? 'active'),
  ),
  defineTool(
    'monize_search_payees',
    'Search active payees by name substring. Returns up to `limit` matches (default 10).',
    {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: ['query'],
    },
    (args) =>
      payeesApi.search(
        String(args.query),
        typeof args.limit === 'number' ? args.limit : 10,
      ),
  ),
  defineTool(
    'monize_get_payee',
    'Get a single payee by id.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    (args) => payeesApi.getById(String(args.id)),
  ),
  defineTool(
    'monize_create_payee',
    'Create a payee. Provide name and optional defaultCategoryId and notes.',
    {
      type: 'object',
      properties: {
        name: { type: 'string' },
        defaultCategoryId: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['name'],
    },
     
    (args) => payeesApi.create(args as any),
  ),
  defineTool(
    'monize_update_payee',
    'Update a payee by id. Pass only the fields to change (name, defaultCategoryId, notes, isActive).',
    {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        defaultCategoryId: { type: 'string' },
        notes: { type: 'string' },
        isActive: { type: 'boolean' },
      },
      required: ['id'],
    },
    (args) => {
      const { id, ...data } = args;
       
      return payeesApi.update(String(id), data as any);
    },
  ),
  defineTool(
    'monize_delete_payee',
    'Delete a payee by id.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async (args) => {
      await payeesApi.delete(String(args.id));
      return { deleted: true, id: args.id };
    },
  ),
];
