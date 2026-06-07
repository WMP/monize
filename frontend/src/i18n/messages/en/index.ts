// Aggregated English message catalog.
// Each namespace lives in its own JSON file so feature work stays isolated.
// English is the base locale and the fallback for any missing key in other locales.
import accounts from './accounts.json';
import admin from './admin.json';
import ai from './ai.json';
import auth from './auth.json';
import bills from './bills.json';
import budgets from './budgets.json';
import categories from './categories.json';
import common from './common.json';
import currencies from './currencies.json';
import dashboard from './dashboard.json';
import importNs from './import.json';
import insights from './insights.json';
import investments from './investments.json';
import layout from './layout.json';
import nav from './nav.json';
import payees from './payees.json';
import reconcile from './reconcile.json';
import reports from './reports.json';
import scheduledTransactions from './scheduledTransactions.json';
import securities from './securities.json';
import settings from './settings.json';
import tags from './tags.json';
import transactions from './transactions.json';
import ui from './ui.json';

const messages = {
  accounts,
  admin,
  ai,
  auth,
  bills,
  budgets,
  categories,
  common,
  currencies,
  dashboard,
  import: importNs,
  insights,
  investments,
  layout,
  nav,
  payees,
  reconcile,
  reports,
  scheduledTransactions,
  securities,
  settings,
  tags,
  transactions,
  ui,
};

export default messages;
