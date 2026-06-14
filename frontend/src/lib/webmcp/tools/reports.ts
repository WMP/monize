import { builtInReportsApi } from '@/lib/built-in-reports';
import { defineTool, type WebMcpTool } from '../types';

const DATE_RANGE_SCHEMA = {
  type: 'object' as const,
  properties: {
    startDate: { type: 'string', description: 'YYYY-MM-DD' },
    endDate: { type: 'string', description: 'YYYY-MM-DD' },
  },
};

export const reportTools: WebMcpTool[] = [
  defineTool(
    'monize_report_spending_by_category',
    'Read-only report: total spending grouped by category for a date range.',
    DATE_RANGE_SCHEMA,
     
    (args) => builtInReportsApi.getSpendingByCategory(args as any),
  ),
  defineTool(
    'monize_report_income_vs_expenses',
    'Read-only report: income vs expenses totals for a date range.',
    DATE_RANGE_SCHEMA,
     
    (args) => builtInReportsApi.getIncomeVsExpenses(args as any),
  ),
  defineTool(
    'monize_report_monthly_category_breakdown',
    'Read-only report: category-by-month matrix (the Monthly Category Breakdown), including an Uncategorized bucket.',
    DATE_RANGE_SCHEMA,
     
    (args) => builtInReportsApi.getMonthlyCategoryBreakdown(args as any),
  ),
];
