import { categoriesApi } from '@/lib/categories';
import { defineTool, EMPTY_SCHEMA, type WebMcpTool } from '../types';

export const categoryTools: WebMcpTool[] = [
  defineTool(
    'monize_list_categories',
    'List all of the user\'s categories (id, name, type, parent). Use this to resolve a category name to its id before creating or updating transactions.',
    EMPTY_SCHEMA,
    () => categoriesApi.getAll(),
  ),
  defineTool(
    'monize_get_category',
    'Get a single category by id.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    (args) => categoriesApi.getById(String(args.id)),
  ),
  defineTool(
    'monize_create_category',
    'Create a category. Provide name and isIncome (true for income, false for expense); optional parentId for a subcategory and color (hex).',
    {
      type: 'object',
      properties: {
        name: { type: 'string' },
        isIncome: { type: 'boolean' },
        parentId: { type: 'string' },
        color: { type: 'string' },
      },
      required: ['name'],
    },
     
    (args) => categoriesApi.create(args as any),
  ),
  defineTool(
    'monize_update_category',
    'Update a category by id. Pass only the fields to change (name, isIncome, parentId, color).',
    {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        isIncome: { type: 'boolean' },
        parentId: { type: 'string' },
        color: { type: 'string' },
      },
      required: ['id'],
    },
    (args) => {
      const { id, ...data } = args;
       
      return categoriesApi.update(String(id), data as any);
    },
  ),
  defineTool(
    'monize_delete_category',
    'Delete a category by id. Fails if the category still has transactions; reassign them first.',
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async (args) => {
      await categoriesApi.delete(String(args.id));
      return { deleted: true, id: args.id };
    },
  ),
];
