import { AiToolDefinition } from "../providers/ai-provider.interface";
import {
  SECURITY_EXCHANGES,
  SECURITY_TYPES,
} from "../../securities/security-enums";

export const FINANCIAL_TOOLS: AiToolDefinition[] = [
  {
    name: "query_transactions",
    description:
      "Search and aggregate transaction data. Returns totals, counts, and breakdowns — never individual transaction details. Use this for questions about spending, income, or transaction patterns.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description:
            "Start date in YYYY-MM-DD format. Omit to default to 30 days ago.",
        },
        endDate: {
          type: "string",
          description:
            "End date in YYYY-MM-DD format. Omit to default to today.",
        },
        categoryNames: {
          type: "array",
          items: { type: "string" },
          description:
            'Filter by category names (e.g., ["Groceries", "Dining Out"]). Use exact names from the user\'s category list. To target a subcategory unambiguously, use "Parent: Child" notation (e.g., "Food: Dining Out"). If any name cannot be resolved the tool returns an error -- call get_categories first if unsure.',
        },
        accountNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by account names. Use exact names from the user's account list.",
        },
        searchText: {
          type: "string",
          description: "Search payee names or transaction descriptions",
        },
        groupBy: {
          type: "string",
          enum: ["category", "payee", "year", "month", "week"],
          description: "How to group results for breakdown",
        },
        direction: {
          type: "string",
          enum: ["expenses", "income", "both"],
          description:
            "Filter by direction. Must be EXACTLY one of: 'expenses' (outflows/spending), 'income' (inflows/earnings), or 'both' (default). Do not use 'expense', 'all', 'debit', or any variation.",
        },
      },
    },
  },
  {
    name: "get_account_balances",
    description:
      "Get current account balances, total assets, total liabilities, and net worth. Use this for questions about how much money the user has.",
    inputSchema: {
      type: "object",
      properties: {
        accountNames: {
          type: "array",
          items: { type: "string" },
          description: "Optional: filter to specific account names",
        },
        status: {
          type: "string",
          enum: ["open", "closed", "all"],
          description:
            "Which accounts to include by status. 'open' returns only active accounts, 'closed' returns only closed accounts, 'all' returns both. Defaults to 'open'.",
        },
        accountTypes: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "CHEQUING",
              "SAVINGS",
              "CREDIT_CARD",
              "LOAN",
              "MORTGAGE",
              "INVESTMENT",
              "CASH",
              "LINE_OF_CREDIT",
              "ASSET",
              "OTHER",
            ],
          },
          description:
            "Optional: filter to specific account types. Values must be UPPER_SNAKE_CASE exactly as listed. Omit to include all account types.",
        },
      },
    },
  },
  {
    name: "get_categories",
    description:
      "List the user's categories with their hierarchy (parent names) and transaction counts. Use this for questions like 'what categories do I have', 'list my income categories', or 'do I have a category for groceries'. Returns a flat list with each category's parent name so hierarchy is visible without nested JSON. Do not use this to query spending amounts -- use get_spending_by_category for that.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["expense", "income", "all"],
          description:
            "Filter by category type. 'expense' returns only expense categories, 'income' returns only income categories, 'all' returns both. Defaults to 'all'.",
        },
        search: {
          type: "string",
          description:
            "Optional case-insensitive substring match on category name. If a matching category is a subcategory, its parent is included so the hierarchy stays visible.",
        },
      },
    },
  },
  {
    name: "get_spending_by_category",
    description:
      "Get a breakdown of spending (expenses) by category for a given date range. Returns each category with its total amount, percentage of total spending, and transaction count. Sorted by amount descending.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description:
            "Start date (YYYY-MM-DD). Omit to default to 30 days ago.",
        },
        endDate: {
          type: "string",
          description: "End date (YYYY-MM-DD). Omit to default to today.",
        },
        topN: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description:
            'Integer between 1 and 50 to limit to the top N categories by amount. MUST be a number like 10 (not a string like "10" or "all"). Omit to default to 10.',
        },
      },
    },
  },
  {
    name: "get_income_summary",
    description:
      "Get income summary for a date range, broken down by category, payee (source), or month.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description:
            "Start date (YYYY-MM-DD). Omit to default to 30 days ago.",
        },
        endDate: {
          type: "string",
          description: "End date (YYYY-MM-DD). Omit to default to today.",
        },
        groupBy: {
          type: "string",
          enum: ["category", "payee", "month"],
          description: "How to group income (default: category)",
        },
      },
    },
  },
  {
    name: "get_net_worth_history",
    description:
      "Get monthly net worth history showing assets, liabilities, and net worth over time. Use for trend questions about overall financial health.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "Start date (YYYY-MM-DD). Defaults to 12 months ago.",
        },
        endDate: {
          type: "string",
          description: "End date (YYYY-MM-DD). Defaults to today.",
        },
      },
    },
  },
  {
    name: "compare_periods",
    description:
      "Compare spending or income between two time periods. Returns a side-by-side comparison showing absolute and percentage changes. Use for questions like 'compare this month vs last month'. If any of the four date fields are omitted, defaults to the previous full month (period1) vs the current month-to-date (period2).",
    inputSchema: {
      type: "object",
      properties: {
        period1Start: {
          type: "string",
          description:
            "First period start date (YYYY-MM-DD). Omit to default to the start of last month.",
        },
        period1End: {
          type: "string",
          description:
            "First period end date (YYYY-MM-DD). Omit to default to the last day of last month.",
        },
        period2Start: {
          type: "string",
          description:
            "Second period start date (YYYY-MM-DD). Omit to default to the start of the current month.",
        },
        period2End: {
          type: "string",
          description:
            "Second period end date (YYYY-MM-DD). Omit to default to today.",
        },
        groupBy: {
          type: "string",
          enum: ["category", "payee"],
          description: "How to group comparison (default: category)",
        },
        direction: {
          type: "string",
          enum: ["expenses", "income", "both"],
          description:
            "Filter by direction. Must be EXACTLY one of: 'expenses' (default), 'income', or 'both'. Do not use 'expense', 'all', or any variation.",
        },
      },
    },
  },
  {
    name: "get_portfolio_summary",
    description:
      "Get the user's investment holdings and portfolio performance. Returns each held security (symbol, name, security type, quantity, cost basis, current market value, unrealized gain/loss, and percent return) plus portfolio-wide totals (total holdings value, total cost basis, total portfolio value, total unrealized gain/loss, time-weighted return, CAGR) and asset allocation percentages. Holdings are sorted by market value descending. Use this for questions like 'what stocks do I own', 'how is my portfolio performing', 'what's my asset allocation', or 'how much have I made on <symbol>'. Market values come from the latest stored security prices -- they may be a day or two stale if price updates haven't run.",
    inputSchema: {
      type: "object",
      properties: {
        accountNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: filter to specific investment account names. Use exact names from the user's account list. Omit to cover all investment accounts.",
        },
      },
    },
  },
  {
    name: "query_investment_transactions",
    description:
      "Query the user's brokerage investment-account transactions (buys, sells, dividends, interest, capital gains, splits, transfers, reinvestments, share adjustments). Returns aggregate totals (count, total amount, total commission, action breakdown) and a capped list of matching transactions. Optionally group the results by account, date, security (symbol), or transaction type (action). Use this for questions like 'what did I buy last month', 'show my AAPL trades', 'how much did I pay in commissions', or 'what dividends did I receive'. Do not use for the current portfolio holdings or unrealized gains — use get_portfolio_summary for that.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "Optional start date (YYYY-MM-DD).",
        },
        endDate: {
          type: "string",
          description: "Optional end date (YYYY-MM-DD).",
        },
        accountNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: filter to specific investment account names. Use exact names from the user's account list.",
        },
        symbols: {
          type: "array",
          items: { type: "string" },
          description:
            'Optional: filter to specific security ticker symbols (e.g., ["AAPL", "MSFT"]). Case insensitive.',
        },
        actions: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "BUY",
              "SELL",
              "DIVIDEND",
              "INTEREST",
              "CAPITAL_GAIN",
              "SPLIT",
              "TRANSFER_IN",
              "TRANSFER_OUT",
              "REINVEST",
              "ADD_SHARES",
              "REMOVE_SHARES",
            ],
          },
          description:
            "Optional: filter to specific transaction types. Values must be UPPER_SNAKE_CASE exactly as listed.",
        },
        groupBy: {
          type: "string",
          enum: ["account", "date", "security", "action"],
          description:
            "Group the results by account name, transaction date, security symbol, or action type. Defaults to 'security' when omitted.",
        },
      },
    },
  },
  {
    name: "get_capital_gains",
    description:
      "Get per-period capital gains (realized + unrealized) for the user's investment accounts. Replays transaction history against historical close prices, so the result includes mark-to-market movement on currently-held positions in addition to realized gains from SELLs. Useful for 'how did my portfolio do last year', 'did I have any unrealized losses last month', or 'which securities drove my gains this quarter'. Returns period totals plus a breakdown grouped by month, security, or account. Requires startDate and endDate. All monetary values are in the holding account's currency; when a bucket spans accounts with different currencies its 'currency' field is null and sums are mixed.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "Start date of the window (YYYY-MM-DD). Required.",
        },
        endDate: {
          type: "string",
          description: "End date of the window (YYYY-MM-DD). Required.",
        },
        accountNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: filter to specific investment account names. Use exact names from the user's account list.",
        },
        symbols: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: filter to specific security ticker symbols (case insensitive).",
        },
        groupBy: {
          type: "string",
          enum: ["month", "security", "account"],
          description:
            "Bucket the breakdown by month, security (symbol), or account. Defaults to 'month' when omitted.",
        },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "get_transfers",
    description:
      "Get transfer activity between the user's own accounts for a date range. Returns per-account inbound (money received from another account), outbound (money sent to another account), net movement, and transfer count. Transfers are deliberately excluded from spending and income tools because they net to zero across accounts; use this tool for questions like 'how much did I move into my savings', 'what went out of chequing to other accounts', or 'what are my transfers between accounts'.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description:
            "Start date (YYYY-MM-DD). Omit to default to 30 days ago.",
        },
        endDate: {
          type: "string",
          description: "End date (YYYY-MM-DD). Omit to default to today.",
        },
        accountNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: filter to specific account names. Use exact names from the user's account list.",
        },
      },
    },
  },
  {
    name: "get_upcoming_bills",
    description:
      "Get upcoming scheduled bills and deposits due within a date window. Each item is classified as bill (scheduled outflow), deposit (scheduled inflow), transfer, or investment, and includes a daysUntilDue value (negative when overdue). Returns rollup totals for upcoming bills and deposits plus the per-item list. Use for questions like 'what bills are coming up', 'when is rent due', or 'what deposits am I expecting this month'.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 1,
          maximum: 365,
          description:
            "Number of days to look ahead from today. Defaults to 30. Includes overdue items (daysUntilDue < 0) that have not been posted yet.",
        },
        kind: {
          type: "string",
          enum: ["bill", "deposit", "transfer", "investment", "all"],
          description:
            "Narrow to a single kind: 'bill' (scheduled outflow), 'deposit' (scheduled inflow), 'transfer' (between own accounts), or 'investment'. Omit or pass 'all' to include everything.",
        },
        accountNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: filter to specific account names. Use exact names from the user's account list.",
        },
      },
    },
  },
  {
    name: "get_scheduled_transactions",
    description:
      "List all scheduled/recurring transactions (bills, deposits, transfers, investments), regardless of whether they're due soon. Returns rollup counts plus a curated per-item payload with kind, frequency, next due date, account, and amount. Use for questions like 'what recurring bills do I have', 'list all my scheduled deposits', or 'which schedules are paused'.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["bill", "deposit", "transfer", "investment", "all"],
          description:
            "Narrow to a single kind: 'bill' (scheduled outflow), 'deposit' (scheduled inflow), 'transfer' (between own accounts), or 'investment'. Omit or pass 'all' to include everything.",
        },
        accountNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: filter to specific account names. Use exact names from the user's account list.",
        },
        isActive: {
          type: "boolean",
          description:
            "Filter by active status. true = only active schedules, false = only paused. Omit to include both.",
        },
      },
    },
  },
  {
    name: "get_budget_status",
    description:
      "Get budget status for a specific period. Returns total budgeted vs actual spending, per-category breakdowns, spending velocity, safe daily spend, and health score. Use for questions like 'how am I doing on my budget?', 'which categories am I overspending in?', or 'how much can I still spend this month?'.",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          description:
            "Which period to check: 'CURRENT' for the current month, 'PREVIOUS' for last month, or a specific month in YYYY-MM format. Default: CURRENT.",
        },
        budgetName: {
          type: "string",
          description:
            "Optional: filter to a specific budget by name. If omitted, uses the first active budget.",
        },
      },
    },
  },
  {
    name: "calculate",
    description:
      "Perform accurate server-side arithmetic on numbers from previous tool results. Use this instead of doing math yourself. Supports: percentage (part/whole*100), difference (a-b), ratio (a/b), sum, and average. Always use this tool for any calculation rather than computing values yourself.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["percentage", "difference", "ratio", "sum", "average"],
          description:
            "The arithmetic operation to perform. 'percentage' computes (values[0] / values[1]) * 100. 'difference' computes values[0] - values[1]. 'ratio' computes values[0] / values[1]. 'sum' adds all values. 'average' computes the arithmetic mean.",
        },
        values: {
          type: "array",
          items: { type: "number" },
          minItems: 1,
          description:
            "The numbers to calculate with. For percentage, difference, and ratio: [a, b]. For sum and average: any number of values.",
        },
        label: {
          type: "string",
          description:
            "Optional label describing what this calculation represents (e.g., 'savings rate', 'monthly average spending').",
        },
      },
      required: ["operation", "values"],
    },
  },
  {
    name: "render_chart",
    description:
      "Render a chart in the chat so the user can see the data visually. Call this AFTER gathering numbers with another tool (query_transactions, get_spending_by_category, get_net_worth_history, compare_periods, etc.). Choose the chart type that fits the data: 'pie' for category breakdowns with 6 or fewer slices, 'bar' for larger breakdowns or period comparisons, 'line' or 'area' for time series (months or weeks). Pass a compact subset of the data (at most 10-15 data points) and aggregate the long tail into an 'Other' bucket. Values must be positive numbers (use absolute values for expenses). Do not narrate the chart's existence in your reply; just render it and summarize the findings.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["bar", "pie", "line", "area"],
          description:
            "Chart type. 'bar' and 'pie' for categorical breakdowns; 'line' and 'area' for time series.",
        },
        title: {
          type: "string",
          description:
            "Short, human-readable chart title (for example, 'Spending by Category — March 2026'). Max 120 characters.",
        },
        data: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description:
                  "Data point label (category name, month, period, etc.). Max 80 characters.",
              },
              value: {
                type: "number",
                description:
                  "Non-negative numeric value for this data point. Use absolute values for expenses.",
              },
            },
            required: ["label", "value"],
          },
          description:
            "Data points to chart. Keep to 10-15 entries for readability; aggregate the tail into an 'Other' bucket.",
        },
      },
      required: ["type", "title", "data"],
    },
  },
  {
    name: "search_transactions",
    description:
      "Find individual transactions and return their IDs along with date, payee, amount, category, and account. Use this ONLY when you need a specific transaction's ID to act on it (for example before an update or delete via manage_transactions), or when the user explicitly asks to see specific transactions. For totals, breakdowns, and spending questions use query_transactions instead. Returns a small capped list.",
    inputSchema: {
      type: "object",
      properties: {
        searchText: {
          type: "string",
          description: "Match payee names or transaction descriptions.",
        },
        startDate: {
          type: "string",
          description: "Start date (YYYY-MM-DD).",
        },
        endDate: {
          type: "string",
          description: "End date (YYYY-MM-DD).",
        },
        accountName: {
          type: "string",
          description:
            "Filter to a single account. Use an exact name from the user's account list.",
        },
        categoryName: {
          type: "string",
          description:
            'Filter to a single category. Use an exact name from the user\'s category list ("Parent: Child" for a subcategory).',
        },
        minAmount: {
          type: "number",
          description: "Minimum signed amount (negative for expenses).",
        },
        maxAmount: {
          type: "number",
          description: "Maximum signed amount.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          description:
            "Maximum number of rows to return (1-25). Defaults to 25.",
        },
      },
    },
  },
  {
    name: "manage_transactions",
    description:
      "Create, update, or delete the user's cash transactions (including transfers between their own accounts). This does NOT change anything immediately: it shows the user one or more confirmation cards they must explicitly approve before anything is saved. Use it only when the user clearly asks to add, edit, categorize, transfer, or delete a transaction in their latest message. Accepts NAMES for account, category, and payee -- they are resolved internally, so you do NOT need to look up IDs first. " +
      "operation = 'create' | 'update' | 'delete'. Provide an 'items' array (1-25 rows). " +
      "create (standard): { accountName, amount, date, payeeName?, categoryName?, description?, createPayeeIfMissing? } -- amount is positive for income, negative for expenses. " +
      "create (transfer): { fromAccountName, toAccountName, amount, date, description?, payeeName?, createPayeeIfMissing?, exchangeRate?, toAmount? } -- an item is a transfer when toAccountName is present; amount is the positive transfer amount (exchangeRate/toAmount only for cross-currency); payeeName is an optional custom label for the transfer, matched to an existing payee (or created if missing, like a normal transaction) and applied to both legs (omit to auto-generate 'Transfer to/from <account>'). " +
      "update: { transactionId, amount?, date?, payeeName?, categoryName?, description?, createPayeeIfMissing? } -- provide only the fields to change (at least one); a category-only change is just transactionId + categoryName. First call search_transactions to obtain the transactionId. Transfers are auto-detected and edited correctly; for a transfer, payeeName sets its custom label (matched to an existing payee or created if missing, like a normal transaction). " +
      "delete: { transactionId } -- removes the transaction (and any linked transfer legs / split children). First call search_transactions to obtain the transactionId. " +
      "approvalMode = 'bulk' (default) shows one card for the whole batch; 'individual' shows one card per item the user approves separately. Ignored for a single item. Maximum 25 items per call; if the user pastes more, process the first 25 and tell them to send the rest. After calling this tool, briefly tell the user to review and approve the card(s); never claim the change was applied.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["create", "update", "delete"],
          description: "The operation to perform on every item.",
        },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          description:
            "The rows to act on (1-25). Row shape depends on operation; see the tool description.",
          items: {
            type: "object",
            properties: {
              accountName: {
                type: "string",
                description:
                  "create (standard): account for the transaction. Exact name from the user's account list.",
              },
              fromAccountName: {
                type: "string",
                description:
                  "create (transfer): source account. Presence of toAccountName makes the item a transfer.",
              },
              toAccountName: {
                type: "string",
                description:
                  "create (transfer): destination account. Exact name from the user's account list.",
              },
              transactionId: {
                type: "string",
                description:
                  "update/delete: ID of the transaction, obtained from search_transactions.",
              },
              amount: {
                type: "number",
                description:
                  "Signed amount for standard create/update (positive=income, negative=expense); positive transfer amount for a transfer. Up to 4 decimal places.",
              },
              date: {
                type: "string",
                description: "Transaction date (YYYY-MM-DD).",
              },
              payeeName: {
                type: "string",
                description:
                  "Optional payee name (standard create/update; matched to an existing payee when one exists, otherwise handled per createPayeeIfMissing). For a transfer (create/update), this is a custom label applied to both legs that is matched to an existing payee when one exists, otherwise handled per createPayeeIfMissing (omit to auto-generate 'Transfer to/from <account>').",
              },
              categoryName: {
                type: "string",
                description:
                  'Optional category (standard create/update). Exact name from the user\'s category list ("Parent: Child" for a subcategory).',
              },
              description: {
                type: "string",
                description: "Optional description or memo.",
              },
              createPayeeIfMissing: {
                type: "boolean",
                description:
                  "When the payee name matches no existing payee, create a new payee on approval (true, default) or record the name as free text (false). Applies to standard and transfer create/update.",
              },
              exchangeRate: {
                type: "number",
                description:
                  "create (transfer): exchange rate for a cross-currency transfer. Omit for same-currency.",
              },
              toAmount: {
                type: "number",
                description:
                  "create (transfer): explicit destination amount for a cross-currency transfer. Overrides exchangeRate.",
              },
            },
          },
        },
        approvalMode: {
          type: "string",
          enum: ["bulk", "individual"],
          description:
            "How multi-item batches are approved: 'bulk' (default) = one card for all items; 'individual' = one card per item. Ignored when there is a single item.",
        },
      },
      required: ["operation", "items"],
    },
  },
  {
    name: "create_payee",
    description:
      "Propose creating a new payee. This does NOT create anything immediately: it shows the user a confirmation card they must approve. Use it only when the user clearly asks to add a payee. After calling this tool, briefly tell the user to review and approve the card; never claim the payee was created.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Payee name.",
        },
        defaultCategoryName: {
          type: "string",
          description:
            "Optional default category for this payee. Use an exact name from the user's category list.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "lookup_securities",
    description:
      "Look up a ticker symbol or company name against the user's configured price provider (Yahoo/MSN) and return the list of matching securities (symbol, name, exchange, type, currency) WITHOUT adding anything. This is read-only and does not change the user's data. Use it when the user wants to add a security but the reference is ambiguous, or to confirm the exact symbol/exchange before calling create_security: present the matches and ask the user which one they mean. Each candidate is flagged with alreadyAdded=true when a security with that symbol is already in the user's list.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Ticker symbol (e.g. 'AAPL') or company/security name (e.g. 'Apple') to search for. Required.",
        },
        exchange: {
          type: "string",
          enum: [...SECURITY_EXCHANGES],
          description:
            "Optional exchange to narrow the search when a symbol trades on more than one exchange. MUST be exactly one of the listed values; omit to search across exchanges.",
        },
        provider: {
          type: "string",
          enum: ["yahoo", "msn", "auto"],
          description:
            "Optional quote provider to query: 'yahoo', 'msn', or 'auto' (the user's configured default, the recommended choice). Omit for 'auto'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "create_security",
    description:
      "Propose adding a new security (stock, ETF, mutual fund, etc.) to the user's security list so it can later be traded or held. This does NOT create anything immediately: it shows the user a confirmation card they must explicitly approve before the security is saved. Use it only when the user clearly asks to add a security in their latest message. The security is looked up and validated automatically by ticker symbol or name against the user's configured price provider, which fills in the official symbol, name, exchange, type, and currency -- do not invent those. Provide the optional `exchange` only to disambiguate a symbol that trades on several exchanges (e.g. a dual-listed ticker); if the lookup is ambiguous the tool returns an error listing the candidates so you can re-call with an exchange. Only ever pass `exchange`/`securityType` values from the enumerated lists below; never guess a value outside them. One security per call -- call the tool again for each additional security. After calling this tool, briefly tell the user to review and approve the card; never claim the security was created.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Ticker symbol (e.g. 'AAPL') or security name (e.g. 'Apple Inc.') to look up and validate. Required.",
        },
        exchange: {
          type: "string",
          enum: [...SECURITY_EXCHANGES],
          description:
            "Optional stock exchange used to disambiguate the lookup when a symbol trades on more than one exchange. MUST be exactly one of the listed values; omit it to let the lookup choose the best match. Do not guess an exchange not in this list.",
        },
        securityType: {
          type: "string",
          enum: [...SECURITY_TYPES],
          description:
            "Optional security type override. MUST be exactly one of the listed values (UPPER_SNAKE_CASE). Omit it to use the type the lookup determines. Do not guess a type not in this list.",
        },
        isFavourite: {
          type: "boolean",
          description:
            "Optional: pin the new security to the dashboard Favourite Securities widget. Defaults to false.",
        },
        currencyCode: {
          type: "string",
          description:
            "Optional ISO 4217 currency code (e.g. 'USD', 'CAD') for the security. Overrides the currency the lookup determines, and lets creation proceed when the lookup can't determine one. Omit to use the looked-up currency.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "create_investment_transaction",
    description:
      "Propose creating a brokerage/investment-account transaction (any type: buy, sell, dividend, interest, capital gain, stock split, transfer in/out, dividend reinvestment, or share add/remove). This does NOT create anything immediately: it shows the user a confirmation card they must explicitly approve. Use it only when the user clearly asks to record an investment transaction in their latest message. The security is matched automatically by ticker symbol or by name; if the reference is ambiguous or unknown the tool returns an error listing candidates. Buys debit, and sells/dividends/interest/capital gains credit, the brokerage's linked cash account automatically -- do not also record a separate cash transaction. After calling this tool, briefly tell the user to review and approve the card; never claim the transaction was created.",
    inputSchema: {
      type: "object",
      properties: {
        accountName: {
          type: "string",
          description:
            "Investment/brokerage account for the transaction. Use an exact name from the user's account list.",
        },
        action: {
          type: "string",
          enum: [
            "BUY",
            "SELL",
            "DIVIDEND",
            "INTEREST",
            "CAPITAL_GAIN",
            "SPLIT",
            "TRANSFER_IN",
            "TRANSFER_OUT",
            "REINVEST",
            "ADD_SHARES",
            "REMOVE_SHARES",
          ],
          description:
            "Transaction type. Values must be UPPER_SNAKE_CASE exactly as listed.",
        },
        date: {
          type: "string",
          description: "Transaction date (YYYY-MM-DD).",
        },
        security: {
          type: "string",
          description:
            "Security ticker symbol (e.g. 'AAPL') or name (e.g. 'Apple Inc.'). Required for BUY, SELL, SPLIT, REINVEST, ADD_SHARES, and REMOVE_SHARES; optional for cash-only INTEREST. Matched automatically to one of the user's securities.",
        },
        quantity: {
          type: "number",
          description:
            "Number of shares (up to 8 decimal places). For a SPLIT, the post-split-to-pre-split ratio (e.g. 2 for a 2-for-1 split); must be greater than zero.",
        },
        price: {
          type: "number",
          description:
            "Price per share (up to 6 decimal places). For DIVIDEND/INTEREST/CAPITAL_GAIN with no quantity, the total cash amount.",
        },
        commission: {
          type: "number",
          description:
            "Commission or fee (up to 4 decimal places). Defaults to 0.",
        },
        fundingAccountName: {
          type: "string",
          description:
            "Optional cash account that funds a buy or receives a sell's proceeds. Use an exact account name. Omit to use the brokerage account's own linked cash account.",
        },
        description: {
          type: "string",
          description: "Optional description or memo.",
        },
      },
      required: ["accountName", "action", "date"],
    },
  },
  {
    name: "create_investment_transactions",
    description:
      "Propose creating SEVERAL brokerage/investment-account transactions at once from a list or pasted table (e.g. the user copies a table of trades from a brokerage webpage). This does NOT create anything immediately: it shows the user ONE confirmation card listing every row, which they review and approve with a single click. Parse the pasted data into the rows array, one entry per trade; do not fabricate rows. Each security is matched automatically by ticker symbol or name. Buys debit, and sells/dividends/interest/capital gains credit, the brokerage's linked cash account automatically. Maximum 25 rows per call -- if the user pastes more, process the first 25 and tell them to send the rest separately. After calling this tool, briefly tell the user to review and approve the card; never claim the transactions were created. For a single transaction, use create_investment_transaction instead.",
    inputSchema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          description:
            "The investment transactions to propose, one entry per row (1-25 entries).",
          items: {
            type: "object",
            properties: {
              accountName: {
                type: "string",
                description:
                  "Investment/brokerage account. Use an exact name from the user's account list.",
              },
              action: {
                type: "string",
                enum: [
                  "BUY",
                  "SELL",
                  "DIVIDEND",
                  "INTEREST",
                  "CAPITAL_GAIN",
                  "SPLIT",
                  "TRANSFER_IN",
                  "TRANSFER_OUT",
                  "REINVEST",
                  "ADD_SHARES",
                  "REMOVE_SHARES",
                ],
                description:
                  "Transaction type. Values must be UPPER_SNAKE_CASE exactly as listed.",
              },
              date: {
                type: "string",
                description: "Transaction date (YYYY-MM-DD).",
              },
              security: {
                type: "string",
                description:
                  "Security ticker symbol or name. Required for BUY, SELL, SPLIT, REINVEST, ADD_SHARES, and REMOVE_SHARES; optional for cash-only INTEREST.",
              },
              quantity: {
                type: "number",
                description:
                  "Number of shares (up to 8 decimal places). For a SPLIT, the post-split-to-pre-split ratio.",
              },
              price: {
                type: "number",
                description:
                  "Price per share (up to 6 decimal places). For DIVIDEND/INTEREST/CAPITAL_GAIN with no quantity, the total cash amount.",
              },
              commission: {
                type: "number",
                description:
                  "Commission or fee (up to 4 decimal places). Defaults to 0.",
              },
              fundingAccountName: {
                type: "string",
                description:
                  "Optional cash account that funds a buy or receives a sell's proceeds. Omit to use the brokerage's own linked cash account.",
              },
              description: {
                type: "string",
                description: "Optional description or memo.",
              },
            },
            required: ["accountName", "action", "date"],
          },
        },
      },
      required: ["rows"],
    },
  },
  {
    name: "update_investment_transaction",
    description:
      "Propose editing an existing brokerage/investment-account transaction. This does NOT change anything immediately: it shows the user a confirmation card they must explicitly approve before the change is saved. First call query_investment_transactions or search the investments to obtain the transactionId. Provide ONLY the fields you want to change -- omitted fields keep their current value. The security, when changed, is matched automatically by ticker symbol or name. The total and cash impact are recomputed from the resulting state. After calling this tool, briefly tell the user to review and approve the card; never claim the change was applied. To delete one, use delete_investment_transaction instead.",
    inputSchema: {
      type: "object",
      properties: {
        transactionId: {
          type: "string",
          description: "ID of the investment transaction to edit.",
        },
        action: {
          type: "string",
          enum: [
            "BUY",
            "SELL",
            "DIVIDEND",
            "INTEREST",
            "CAPITAL_GAIN",
            "SPLIT",
            "TRANSFER_IN",
            "TRANSFER_OUT",
            "REINVEST",
            "ADD_SHARES",
            "REMOVE_SHARES",
          ],
          description:
            "New transaction type. Values must be UPPER_SNAKE_CASE exactly as listed. Omit to keep.",
        },
        date: {
          type: "string",
          description: "New transaction date (YYYY-MM-DD). Omit to keep.",
        },
        security: {
          type: "string",
          description:
            "New security ticker symbol or name. Matched automatically to one of the user's securities. Omit to keep the current security.",
        },
        quantity: {
          type: "number",
          description:
            "New number of shares (up to 8 decimal places). For a SPLIT, the post-split-to-pre-split ratio. Omit to keep.",
        },
        price: {
          type: "number",
          description:
            "New price per share (up to 6 decimal places). For DIVIDEND/INTEREST/CAPITAL_GAIN with no quantity, the total cash amount. Omit to keep.",
        },
        commission: {
          type: "number",
          description:
            "New commission or fee (up to 4 decimal places). Omit to keep.",
        },
        description: {
          type: "string",
          description: "New description or memo. Omit to keep.",
        },
      },
      required: ["transactionId"],
    },
  },
  {
    name: "delete_investment_transaction",
    description:
      "Propose deleting an existing brokerage/investment-account transaction. This does NOT delete anything immediately: it shows the user a confirmation card they must explicitly approve before the transaction is removed. First call query_investment_transactions to obtain the transactionId. Deleting one leg of a security transfer removes the paired leg too, and any linked cash impact is reversed. After calling this tool, briefly tell the user to review and approve the card; never claim the transaction was deleted.",
    inputSchema: {
      type: "object",
      properties: {
        transactionId: {
          type: "string",
          description: "ID of the investment transaction to delete.",
        },
      },
      required: ["transactionId"],
    },
  },
];
