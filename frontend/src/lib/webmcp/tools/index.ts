import type { WebMcpTool } from '../types';
import { accountTools } from './accounts';
import { categoryTools } from './categories';
import { payeeTools } from './payees';
import { transactionTools } from './transactions';
import { budgetTools } from './budgets';
import { reportTools } from './reports';

/**
 * All Monize WebMCP tools, registered on `navigator.modelContext` when the user
 * opts in. Each tool is a thin adapter over the existing frontend API client,
 * so calls run with the user's current authenticated session (cookie + CSRF) --
 * no backend needs to be exposed externally.
 */
export const webMcpTools: WebMcpTool[] = [
  ...accountTools,
  ...categoryTools,
  ...payeeTools,
  ...transactionTools,
  ...budgetTools,
  ...reportTools,
];
