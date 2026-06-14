import { budgetsApi } from '@/lib/budgets';
import { defineTool, EMPTY_SCHEMA, type WebMcpTool } from '../types';

export const budgetTools: WebMcpTool[] = [
  defineTool(
    'monize_list_budgets',
    'List the user\'s budgets.',
    EMPTY_SCHEMA,
    () => budgetsApi.getAll(),
  ),
  defineTool(
    'monize_get_budget',
    'Get a single budget by id.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    (args) => budgetsApi.getById(String(args.id)),
  ),
  defineTool(
    'monize_get_budget_summary',
    'Get the spending-vs-budget summary for a budget by id (budgeted, spent, remaining per category).',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    (args) => budgetsApi.getSummary(String(args.id)),
  ),
  defineTool(
    'monize_create_budget',
    'Create a budget. Provide name and the strategy/period fields the budget form uses.',
    {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
     
    (args) => budgetsApi.create(args as any),
  ),
  defineTool(
    'monize_update_budget',
    'Update a budget by id. Pass only the fields to change.',
    {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id'],
    },
    (args) => {
      const { id, ...data } = args;
       
      return budgetsApi.update(String(id), data as any);
    },
  ),
  defineTool(
    'monize_delete_budget',
    'Delete a budget by id.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async (args) => {
      await budgetsApi.delete(String(args.id));
      return { deleted: true, id: args.id };
    },
  ),
];
