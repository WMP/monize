<p align="center">
  <img src="frontend/public/icons/monize-logo.svg" alt="Monize" width="128" height="128" />
</p>

# Monize
> [!CAUTION] 
> This project is 100% written by AI. I've done practically zero manual changes. I am not a programmer by trade, but have dabbled in various languages over the years. This gives me high-level awareness on coding practices, but **I AM NOT SKILLED IN THE LANGUAGES USED IN THIS PRODUCT**. I have spent months prompting Claude Code for features, updates, fixes and tweaks. I have taken steps to ensure this is secure as it can be, given the constraints. I've performed numerous security audits (both AI-prompted and 3rd party) and have implemented best-practice security measures as much as I can (including 2FA and OIDC support). Every build must pass NPM audits and security scans before publishing. However, I can't personally guarantee the security of this code. **YOU HAVE BEEN WARNED**. 

<div align="center">
<table>
<tr>
<td align="center"><a href="https://raw.githubusercontent.com/wiki/kenlasko/monize/images/dashboard-overview.png"><img src="https://raw.githubusercontent.com/wiki/kenlasko/monize/images/dashboard-overview.png" width="400" alt="Dashboard Overview"/></a></td>
<td align="center"><a href="https://raw.githubusercontent.com/wiki/kenlasko/monize/images/transactions-page.png"><img src="https://raw.githubusercontent.com/wiki/kenlasko/monize/images/transactions-page.png" width="400" alt="Transactions"/></a></td>
<td align="center"><a href="https://raw.githubusercontent.com/wiki/kenlasko/monize/images/bills-deposits-page.png"><img src="https://raw.githubusercontent.com/wiki/kenlasko/monize/images/bills-deposits-page.png" width="400" alt="Bills & Deposits"/></a></td>
<td align="center"><a href="https://raw.githubusercontent.com/wiki/kenlasko/monize/images/investments-page.png"><img src="https://raw.githubusercontent.com/wiki/kenlasko/monize/images/investments-page.png" width="400" alt="Investments"/></a></td>
</tr>
<tr>
<td align="center"><b>Dashboard</b></td>
<td align="center"><b>Transactions</b></td>
<td align="center"><b>Bills & Deposits</b></td>
<td align="center"><b>Investments</b></td>
</tr>
</table>
</div>

A comprehensive personal finance management application built with NestJS and Next.js. Designed as a replacement for Microsoft Money and Intuit Quicken. 100% built using farm-fresh, free-range Claude Code.

<div align="center">

### [**Live Demo**](https://demo.monize.net) | [**Wiki**](https://github.com/kenlasko/monize/wiki) | [**Release Notes**](docs/release-notes/)

</div>

## Why This Exists?
The personal finance ecosystem is flooded with personal finance platforms. I've tried many of them, but every single one of them had deal-breakers I couldn't work with. I finally decided to try my hand at creating my own platform that met all my criteria by using  "vibe-coding", which is a dirty word in the self-hosting community. I just wanted to see what was possible with the current state of AI. It turned out to be more successful than I ever could have imagined, which is why I'm making this available for others.

### A bit of background on my specific situation that brought me to create this project:
I've been a rabid user of [Microsoft Money](https://en.wikipedia.org/wiki/Microsoft_Money) since 1995, when I had my first real job outside of university doing tech support for Microsoft. I started using it to keep track of my finances and to help get myself out of credit card debt. It allowed me to keep track of every aspect of my finances: chequing accounts, credit cards, loans, mortgages, investments, and more. Being software of the 90's, it didn't have much in the way of automation, especially for non-US customers. This forced me to meticulously enter every single transaction manually into Microsoft Money.

This "feature" helped me truly understand the state of my finances. I knew where every single penny went. Nothing was ever a surprise. I could forecast my finances out a year or more with precision. I've kept that going for more than THIRTY YEARS. Yes, even though Microsoft Money hasn't had a new version since 2010, I still use it. Everything from 1995 to today is stored in Microsoft Money. I can tell you my detailed financial picture going back to 1995. It certainly isn't perfect. I can only run it on one machine. There's no mobile app or anything of the sort. When I go on a trip or something, it can take hours after I return to enter and categorize my data. I've been increasingly wanting a true replacement for Microsoft Money. 

My perfect product to replace MS Money needed the following features:
- Must support all types of banking and investment types, including:
  - Chequing
  - Savings
  - Credit Cards
  - Loans
  - Mortgages
  - Line of Credit
  - Brokerage accounts
  - Asset accounts
- Must support importing from QIF (the export format used by MS Money and Quicken)
- Must be self-hostable via containerization
- Must support multiple currencies
- Must support pulling currency exchange rates and stock prices on a regular basis
- Must support PostgreSQL for the backend tables
- Must have a usable mobile app or web interface

Since I couldn't find anything out there to meet that criteria, I decided to create Monize! After weeks of vibe-coding and testing, I finally was able to migrate ALL of 30+ years of Microsoft Money data into Monize with no errors or discrepancies. Microsoft Money has finally been retired!

Monize is running in my [Kubernetes cluster](https://github.com/kenlasko/k8s).


## What's New

Highlights of the recent releases. Every version has full notes in [`docs/release-notes/`](docs/release-notes/), and the app shows a What's New digest after each update.

| Version | Highlights |
|---------|------------|
| 1.17 | Calendar view for transactions and investments, with day notes. Transaction rules (Tools > Rules) and an AI review inbox. Sort the register by any column. London Stock Exchange and Deutsche Börse price sources. Automatic backups copied off the machine (S3 and email). Several backend replicas with `CLUSTER_MODE=multi` |
| 1.16 | Notifications: a type-by-channel matrix, browser push with no third party, UnifiedPush, balance thresholds. Scan paper documents into attachments and preview them in the app. Share files into Monize. Phone layout: tables become cards, swipe between views. Payee address, phone and email, with optional lookup |
| 1.15 | An investment account is shown as one account. Brokerage CSV import. Compare securities against the market. Category detail page. Cash flow forecast over several accounts. Partial dates and remembered row density |
| 1.14 | Microsoft Money full-file import (`.mny`). Joint accounts and transfers between two people. Security and payee detail pages. Your own asset-class allocation. GEM strategy report. Automatic backups |
| 1.13 | Foreign-currency transactions and a fee breakdown. Transaction attachments. Guided tours and the What's New digest. Fixed-payment loan plans. Default categories that match your country |
| 1.12 | Loan and mortgage detail page with an overpayment simulator. A dashboard you can customize, with new widgets. A detail page for every account type. KEY:VALUE tags. Geographic look-through for ETFs and funds |
| 1.11 | Ten more languages. Fifteen colour themes. Financial institutions. Auto-merge duplicate payees. AI Assistant changes that wait for your approval. Attachments in the AI chat |
| 1.10 | Shared access for delegates. Emergency access. Password-protected backups. Custom investment reports |

## Features
### Account Management
- Ten account types: Chequing, Savings, Credit Card, Loan, Mortgage, Line of Credit, Investment, Cash, Asset and Other
- A detail page for each account type: balance history, recurring charges and a 90-day balance forecast for bank accounts; the statement cycle, interest and fees and a payoff calculator for credit cards; value, appreciation and an equity panel for assets
- Financial institutions: group your accounts by bank or brokerage, with the institution's logo
- An investment account is shown as one account (the brokerage and its cash), with a reconciliation status on investment transactions
- Support for multiple currencies per account
- Track balances, credit limits, and interest rates
- Credit card statement dates: configurable due date and settlement date (billing cycle closing date). After you reconcile a card, Monize offers to schedule the payment
- Favourite accounts on dashboard with credit card date indicators
- Account reconciliation: edit, sort and group while you reconcile, an optional lock on reconciled transactions, and highlighted overdue unreconciled transactions
- Export an account to CSV or QIF

### Transaction Management
- Full transaction tracking with categories and payees
- Split transaction support for complex transactions
- Table or Calendar view of the register. Each day shows its transactions and, if you choose, the day's balance or its change. Day notes go on one day or across several
- Sort the register by any column; the running balance is shown in date order
- Search from the header on every page
- Foreign-currency transactions: enter the amount you were charged, see and edit the rate, and see what foreign-currency fees cost you per account
- Attachments for receipts, invoices and statements, stored in the database, on disk or in S3. Scan a paper document with the phone camera (page detection runs in your browser) and preview images and PDFs in the app
- Transaction reconciliation and clearing
- Bulk update and bulk delete operations with filter-based selection
- Undo and redo your recent changes from the action history panel
- Payees with auto-categorization rules, aliases with wildcard patterns, and merge capability, plus Auto-Merge for duplicates
- A page for each payee (statistics, recurrence, seasonality, address, phone and email) and for each category (subcategories, top payees, seasonality). Payee details can be looked up through Google Places or your AI provider, and are shown for confirmation before they are saved
- Multi-currency transactions with automatic exchange rate tracking
- Import from CSV (including brokerage exports), OFX/QFX, and QIF (Quicken and Microsoft Money) with smart column auto-matching
- Microsoft Money full-file import: read a `.mny` file directly -- accounts, transfers, splits, investments, price history, exchange rates and scheduled bills -- and reconcile every balance against the file afterwards ([guide](docs/import-ms-money.md))
- Quicken full-file import: import all accounts, categories, and tags from a single QIF export
- Data reset: wipe financial data and re-import without losing your user account or settings
- Share into the app: with Monize installed as a PWA (Android and desktop Chromium), share a receipt photo, a PDF or a statement export (CSV, OFX, QFX, QIF) to it from another app and land on a review screen that offers to attach it to a new transaction, open the import wizard or send it to the AI Assistant. Nothing is imported or attached until you choose it, and shared files are kept on the device for an hour

### Transaction Rules and Tags
- Transaction rules (Tools > Rules): when a transaction is created or imported and it matches your conditions (account, payee, category, text, amount, day of month, tags and more), add or remove tags, set the category, payee or description, or queue it for an AI review. A visual editor, a test on existing transactions before you save, a run on existing transactions with undo, and a history of every change a rule made. A rule never changes an amount, an account or a date
- An AI review inbox for the transactions a rule queued
- Transaction tags with colours and icons for flexible cross-category labelling
- KEY:VALUE tags (for example `trip:Lisbon`): filter by key, and break Income vs Expenses and Cash Flow down by tag key

### Investment Features
- Track stocks, bonds, ETFs, mutual funds, options, GICs and cryptocurrency
- Exchange-aware symbol resolution for North American, European and Asian markets (NYSE, NASDAQ, AMEX, ARCA, TSX, TSX-V, CSE, NEO, LSE, Frankfurt, XETRA, Euronext Paris, ASX, Tokyo, HKEX)
- Daily price updates from Yahoo Finance, MSN, the London Stock Exchange and Deutsche Börse
- A page for each security: position, price chart, transaction history, documents and news
- Portfolio value and performance charts from intraday and month-to-date up to ten years, all time or a custom date range
- Investment transactions: buy, sell, dividend, interest, reinvestment, capital gains, splits, share additions and removals, and transfers between accounts that keep the cost basis
- Scheduled investment transactions
- Asset-class and country allocation, with look-through for ETFs and funds
- Compare securities against market indexes
- Manual price management: add, edit, and delete individual price entries
- Price backfill from transaction history (uses buy/sell prices when market data unavailable)
- Portfolio tracking with real-time valuations

### Loans and Mortgages
- A page for each loan and mortgage: amortization schedule, interest-rate history, and overpayments recognised the way your bank applies them
- Overpayment simulator with saved scenarios, a goal seek (work backwards from a payoff date), a fixed monthly payment plan and a chart that compares scenarios
- Loan Amortization and Debt Payoff Timeline reports

### Multi-Currency Support
- 44 currencies with built-in symbol and formatting metadata (USD, CAD, EUR, GBP, JPY, CHF, AUD, CNY and more), created on demand rather than pre-seeded
- Daily exchange rate updates, a rate history for each currency, and a Fill gaps button for missing dates
- Automatic currency conversion for reporting
- Per-account currency settings

### Multi-Language Support
- Full user interface translation, including server-generated messages and emails
- Available languages (22 locales): English (with US, Canadian and UK variants), German (Deutsch), Spanish (Español), French (Français), Hindi (हिन्दी), Indonesian (Bahasa Indonesia), Italian (Italiano), Japanese (日本語), Korean (한국어), Dutch (Nederlands), Polish (Polski), Portuguese (Português), Brazilian Portuguese (Português do Brasil), Russian (Русский), Turkish (Türkçe), Ukrainian (Українська), Vietnamese (Tiếng Việt), Simplified Chinese (简体中文) and Traditional Chinese (繁體中文)
- Language can be chosen on the sign-in and registration screens and in Settings -> Preferences
- Numbers follow your own convention, on screen and in the fields you type into (for example a decimal comma, or Indian lakh grouping)

### Scheduled Transactions
- Recurring bills, deposits and transfers with 13 frequencies: once, daily, weekly, every two weeks, every four weeks, twice a month, monthly, every two months, quarterly, every four months, twice a year, yearly and every two years
- Automatic transaction entry option
- Skip and override individual occurrences
- Scheduled transactions in another currency
- Bills calendar, filters, and a cash flow forecast over one or more accounts
- Bill payment history tracking

### Dashboard
- 22 widgets that you can hide, reorder and configure (Customize)
- Each widget title opens its full report
- Fifteen colour themes, each with a light and a dark variant

### Reports
- **Built-in Reports** -- 46 across ten categories (spending, income, net worth, tax, debt, investment, insights, maintenance, budget, bills), all server-side aggregated. A sample:
  - Spending by Category / Payee
  - Income by Source
  - Monthly Spending Trend
  - Income vs Expenses
  - Cash Flow
  - Year over Year Comparison
  - Weekend vs Weekday Spending
  - Spending Anomalies Detection
  - Tax Summary
  - Recurring Expenses
  - Bill Payment History
  - Uncategorized Transactions
  - Duplicate Transaction Finder
- **Net Worth Report**: Historical net worth tracking with monthly snapshots
- **Custom Reports**: Build your own reports with flexible filters
- **Custom Investment Reports**: portfolio views with the columns Microsoft Money offered
- **Monte Carlo retirement simulation**, with a comparison of scenarios
- **GEM (Global Equities Momentum) strategy report**
- Visual charts (pie, bar, line, area)

### Budget Planner
- Create and manage budgets with per-category allocations; a wizard suggests amounts from your spending history
- Track spending against budget targets
- Budget period snapshots and historical tracking
- Budget alerts for threshold notifications

### Notifications
- A notification bell with severity and Financial / System filters
- A preferences grid: each notification type against each channel (email report, email alert, browser push, UnifiedPush)
- Browser push signed with your instance's own keys, with no Firebase or other third party, and UnifiedPush through a distributor you run yourself (ntfy, NextPush)
- Bill reminders, budget alerts, account balance thresholds, daily investment value movements and GEM strategy signals
- System alerts for administrators: a failed backup, a missing `ENCRYPTION_KEY`, a provider outage, failing SMTP
- Reminders that repeat until you stop them, also from the push notification itself

### AI Financial Assistant
- **Natural language queries** about your finances ("How much did I spend on dining last month?", "What are my top expense categories?")
- **Multi-provider support**: Anthropic (Claude), OpenAI (GPT), Ollama (local models), Ollama Cloud, and any OpenAI-compatible endpoint, or your own AI subscription through the MCP relay
- **Real-time streaming** responses via Server-Sent Events
- **21 tools**: transactions, accounts, categories, payees, portfolio, capital gains, upcoming bills, budget status, period comparison, reports, transaction rules, a calculator that converts currencies, and charts
- **Changes on request**: the assistant can add or change transactions, payees, securities and rules, and nothing is written until you approve it
- **Attachments and a chat bubble**: attach images, PDFs and CSV files to a question, and open the chat from any page
- **Spending Insights**: AI analysis of your spending patterns and anomalies
- **Per-user provider configuration** with encrypted API key storage (AES-256-GCM)
- **Usage tracking** with per-request token and cost analytics
- **Provider fallback chain** with priority-based ordering
- **Connection testing** to verify provider setup before use
- **Suggested queries** for quick exploration of your financial data
- **MCP (Model Context Protocol)** server for integration with AI-powered tools, with a one-click connector through OAuth 2.1 or a personal access token
- No financial data is sent to AI providers beyond what is needed to answer the specific query

### Backup and Restore
- Password-protected (encrypted) backups that you download and restore
- Automatic backups for each user, with a list to download or restore from; administrators set the schedule and the retention
- Copies of the automatic backups off the machine: to S3 (append-only) and/or by email
- A Support Backup: an anonymised copy of your data to attach to a bug report ([details](docs/support-backup.md))

### Sharing and Access
- Shared access for delegates, with permissions for each section
- Joint accounts, and transfers between two people's accounts
- Emergency access: trusted contacts receive a one-time link if your account is untouched for a set period, after reminder emails to you

### Mobile and Guided Help
- Install Monize as a PWA on a phone or a desktop
- On a phone, tables become cards and a horizontal swipe moves between views
- Guided tours of the main features, and a What's New digest after each update

### Security
- OIDC (OpenID Connect) authentication (Authentik, Authelia, Pocket-ID, etc.)
- Local credential authentication with bcrypt hashing
- Email verification at registration
- New passwords checked against known breaches (Have I Been Pwned)
- JWT-based session management with httpOnly cookies
- "Remember Me" option with configurable extended session duration (default 30 days)
- TOTP two-factor authentication with trusted device support
- Personal access tokens (PAT) for API and MCP access
- Admin user management with role-based access (admin/user)
- Password reset by an emailed link; an administrator can also issue a temporary password
- Forced password change and forced 2FA policies
- Rate limiting and request throttling
- Helmet security headers (with `DISABLE_HTTPS_HEADERS` option for plain HTTP deployments)
- CORS protection
- Demo mode with sample data and daily resets ([try it](#try-it-with-demo-data))

## Technology Stack

### Backend
- **Framework**: NestJS (Node.js/TypeScript)
- **Database**: PostgreSQL 16+ (developed against PG16, daily usage with PG18)
- **Authentication**: Passport.js (Local & OIDC strategies)
- **API Documentation**: Swagger/OpenAPI (development only)
- **ORM**: TypeORM
- **Validation**: class-validator & class-transformer

### Frontend
- **Framework**: Next.js 16 (React 19/TypeScript)
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Charts**: Recharts
- **Forms**: React Hook Form
- **HTTP Client**: Axios
- **Date Handling**: date-fns

### DevOps
- **Runtime**: Node.js 24
- **Containerization**: Docker & Docker Compose
- **Orchestration**: Kubernetes-ready (Helm charts included)
- **Output**: Next.js standalone build for minimal container size

## Project Structure

```
monize/
├── backend/                    # NestJS backend application
│   ├── src/
│   │   ├── auth/              # Authentication (Local, OIDC, 2FA, trusted devices, PAT)
│   │   ├── users/             # User management & preferences
│   │   ├── admin/             # Admin user management (roles, status, password and 2FA reset)
│   │   ├── accounts/          # Account management
│   │   ├── transactions/      # Transaction management
│   │   ├── categories/        # Category management (hierarchical)
│   │   ├── payees/            # Payee management
│   │   ├── currencies/        # Currency & exchange rates
│   │   ├── securities/        # Stock/security management & portfolio
│   │   ├── scheduled-transactions/   # Recurring payments
│   │   ├── budgets/           # Budget planner & tracking
│   │   ├── notifications/     # Email notifications (SMTP)
│   │   ├── net-worth/         # Net worth calculations
│   │   ├── built-in-reports/  # Server-side report aggregation
│   │   ├── reports/           # User-defined custom reports
│   │   ├── ai/                # AI assistant (providers, query engine, usage tracking)
│   │   ├── mcp/               # Model Context Protocol server
│   │   ├── tags/               # Transaction tags
│   │   ├── transaction-rules/ # Transaction rules (Tools > Rules)
│   │   ├── institutions/      # Financial institutions
│   │   ├── attachments/       # Transaction attachments (database, disk or S3)
│   │   ├── calendar/          # Calendar day notes
│   │   ├── backup/            # Backups, automatic and off-machine
│   │   ├── push/              # Browser push and UnifiedPush
│   │   ├── delegation/        # Shared access for delegates
│   │   ├── emergency-access/  # Emergency access for trusted contacts
│   │   ├── import/            # QIF, CSV, OFX/QFX and Microsoft Money (.mny) file import
│   │   ├── database/          # Seeders, including the demo data (demo-seed-data/)
│   │   ├── health/            # Health check endpoints
│   │   └── main.ts            # Application entry point
│   └── Dockerfile
├── frontend/                   # Next.js frontend application
│   ├── src/
│   │   ├── app/               # Next.js App Router pages
│   │   ├── components/        # React components
│   │   ├── contexts/          # React contexts
│   │   ├── lib/               # API clients and utilities
│   │   ├── hooks/             # Custom React hooks
│   │   ├── store/             # Zustand state stores
│   │   └── types/             # TypeScript type definitions
│   └── Dockerfile
├── database/
│   ├── schema.sql             # Complete PostgreSQL schema
│   └── migrations/            # Incremental schema migrations
├── docs/                      # Contracts, guides and release notes
├── e2e/                       # End-to-end tests
├── helm/                      # Helm charts for Kubernetes
├── docker-compose.dev.yml     # Development environment
├── docker-compose.prod.yml    # Production environment
├── docker-compose.demo.yml    # Demo environment
├── docker-compose.e2e.yml     # End-to-end test environment
├── docker-compose.ha.yml      # Multi-replica example (CLUSTER_MODE=multi)
├── docker-compose.zap.yml     # ZAP security-scan environment
├── .env.example               # Environment variables template
└── README.md
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 24 (for local development -- matches the container images)
- PostgreSQL 16+ (if running without Docker)

### Quick Start with Docker

1. Clone the repository:
```bash
git clone git@github.com:kenlasko/monize.git
cd monize
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Edit `.env` and configure. `JWT_SECRET` and `ENCRYPTION_KEY` ship empty, and
   the backend will not start until both are filled in:
   - `POSTGRES_PASSWORD` - secure database password
   - `JWT_SECRET` - generate with `openssl rand -base64 32`
   - `ENCRYPTION_KEY` - generate with `openssl rand -hex 32`
   - `PUBLIC_APP_URL` - your public frontend URL
   - OIDC settings (optional) for SSO authentication

4. Start the application:
```bash
docker compose -f docker-compose.dev.yml up -d
```

   The `-f` is required: every stack in this repository is an explicit target
   (see the tree above) and there is no default Compose file to fall back on.

5. Access the application:
   - Frontend: http://localhost:3001
   - Backend API: http://localhost:3000

### Try It with Demo Data

`docker-compose.demo.yml` turns on demo mode on top of the production stack.
With the `.env` from steps 2 and 3:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml up -d
```

On its first start the backend seeds a demo account (`demo@monize.com` /
`Demo123!`) with twelve months of data: 15 accounts at five institutions, 36
payees, about 450 transactions with splits and transfers, 10 scheduled
transactions, 8 securities with price history and 4 custom reports. Demo mode
turns off registration, fills in the sign-in form and resets the data every
day at 4:00 AM UTC. The seed is in `backend/src/database/demo-seed-data/`.

### Development Setup (Without Docker)

1. Install backend dependencies:
```bash
cd backend
npm install
```

2. Set up PostgreSQL database:
```bash
createdb monize
psql monize < ../database/schema.sql
```

3. Create `backend/.env`:
```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=monize
DATABASE_USER=your_user
DATABASE_PASSWORD=your_password
JWT_SECRET=            # required: openssl rand -base64 32
ENCRYPTION_KEY=        # required: openssl rand -hex 32
PUBLIC_APP_URL=http://localhost:3001
```

4. Start the backend:
```bash
npm run start:dev
```

5. In a new terminal, set up frontend:
```bash
cd frontend
npm install
cp ../.env.example .env.local  # Update INTERNAL_API_URL if needed
npm run dev
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `POSTGRES_DB` | Database name | `monize` |
| `POSTGRES_USER` | Database user | `monize_user` |
| `POSTGRES_PASSWORD` | Database password | `secure-password` |
| `JWT_SECRET` | JWT signing key (min 32 random chars; the server will not start without it). A published placeholder or typed pattern still starts but is reported to administrators. Changing it later stops authenticator (2FA) codes from working: see [Changing JWT_SECRET](docs/backend/modules-and-runtime.md#changing-jwt_secret) | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | Encrypts AI provider keys, emergency-access credentials, each user's backup key and the Web Push and OIDC signing keys (min 32 chars; the server will not start without it). Keep it safe and keep it unchanged -- losing it makes every stored secret unreadable. Formerly `AI_ENCRYPTION_KEY`, which is still accepted | `openssl rand -hex 32` |
| `PUBLIC_APP_URL` | Public frontend URL | `https://money.example.com` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INTERNAL_API_URL` | Backend URL for server-side calls | `http://localhost:3000` |
| `CORS_ORIGIN` | Additional CORS origin | - |
| `LOCAL_AUTH_ENABLED` | Enable local auth | `true` |
| `REGISTRATION_ENABLED` | Allow new user registration | `true` |
| `FORCE_2FA` | Require 2FA for all local users | `false` |
| `OIDC_ISSUER_URL` | OIDC provider URL | - |
| `OIDC_CLIENT_ID` | OIDC client ID | - |
| `OIDC_CLIENT_SECRET` | OIDC client secret | - |
| `OIDC_CALLBACK_URL` | OIDC callback URL | - |
| `SMTP_HOST` | SMTP server host | - |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_SECURE` | Force implicit TLS on a port other than 465. Port 465 already selects it, and this cannot switch it off | `false` |
| `SMTP_USER` | SMTP username | - |
| `SMTP_PASSWORD` | SMTP password | - |
| `EMAIL_FROM` | Email sender address | - |
| `AI_DEFAULT_PROVIDER` | System-level default AI provider (the centrally managed AI) | - |
| `AI_DEFAULT_MODEL` | Default model for the provider | - |
| `AI_DEFAULT_API_KEY` | System-wide AI API key | - |
| `AI_DEFAULT_BASE_URL` | Base URL for Ollama or compatible endpoints | - |
| `AI_PRIVATE_BASE_URL_ALLOWLIST` | Comma-separated `host` or `host:port` private addresses a non-admin user's Ollama or OpenAI-compatible provider may use. Without an entry, only an admin can point a provider at a private or local address | - |
| `AI_QUERY_MAX_ITERATIONS` | Analysis steps per AI Assistant question, centrally managed provider only | `5` |
| `AI_QUERY_MAX_TOOL_CALLS` | Data lookups per question, centrally managed provider only | `15` |
| `AI_QUERY_TIMEOUT_MINUTES` | Wall-clock minutes per question, centrally managed provider only | `20` |
| `AI_QUERY_MAX_INPUT_TOKENS` | Cumulative input tokens per question, centrally managed provider only | `200000` |
| `AI_QUERY_MAX_TOOL_RESULT_CHARS` | Characters kept from one tool result, centrally managed provider only | `50000` |
| `JWT_EXPIRATION` | JWT token expiration time | `15m` |
| `REMEMBER_ME_DAYS` | Duration for "Remember Me" sessions (days) | `30` |
| `DISABLE_HTTPS_HEADERS` | Disable HSTS and COOP headers for plain HTTP | `false` |
| `DEMO_MODE` | Enable demo mode with sample data | `false` |
| `BACKUP_CONTAINER_DIR` | Container folder automatic backups are written to (each user gets a `<ab>/<cd>/<user-id>/` folder underneath it) | `/data/backups` |
| `BACKUP_HOST_DIR` | Host folder mapped to `BACKUP_CONTAINER_DIR` by docker-compose | `./monize/backups` |
| `ATTACHMENT_CONTAINER_DIR` | Container folder local attachments are written to (was `ATTACHMENT_LOCAL_DIR`) | `/data/attachments` |
| `ATTACHMENT_HOST_DIR` | Host folder mapped to `ATTACHMENT_CONTAINER_DIR` by docker-compose | `./monize/attachments` |

The `AI_DEFAULT_*` and `AI_QUERY_*` variables configure the **centrally managed
AI** -- the provider used for any user who has not configured one of their own.
A user who adds their own provider in Settings -> AI owns its settings
completely, per-provider query limits included, and the environment does not
reach them.


## Deployment

### Docker Compose (Production)

1. Create `.env` from the example and set production values:
```bash
cp .env.example .env
# Edit .env: set NODE_ENV=production, strong passwords, your domain, etc.
```

2. Build and start:
```bash
docker compose -f docker-compose.prod.yml up -d
```

### Kubernetes

The application is Kubernetes-ready with:
- Health endpoints: `/api/v1/health/live` and `/api/v1/health/ready`
- Standalone Next.js build for minimal image size
- Environment-based configuration

Example environment for K8s:
```yaml
# Frontend pod
- name: INTERNAL_API_URL
  value: "http://backend-svc:3000"
- name: PUBLIC_APP_URL
  value: "https://money.example.com"

# Backend pod
- name: PUBLIC_APP_URL
  value: "https://money.example.com"
```

## API Documentation

Swagger UI is available at `/api/docs` in **development mode only** (disabled in production for security).

### Key Endpoints

- `POST /api/v1/auth/register` - Register with local credentials
- `POST /api/v1/auth/login` - Login with local credentials
- `POST /api/v1/auth/2fa/verify` - Verify TOTP 2FA code
- `POST /api/v1/auth/2fa/setup` - Set up 2FA
- `POST /api/v1/auth/2fa/reset` - Reset (replace) your own 2FA with your password and an authenticator or backup code, also under `FORCE_2FA`
- `GET /api/v1/auth/2fa/trusted-devices` - List trusted devices
- `GET /api/v1/auth/oidc` - Initiate OIDC authentication
- `GET /api/v1/accounts` - List accounts
- `GET /api/v1/transactions` - List transactions
- `GET /api/v1/portfolio/summary` - Investment portfolio summary
- `GET /api/v1/portfolio/top-movers` - Daily top movers
- `GET /api/v1/admin/users` - Admin: list all users
- `POST /api/v1/admin/users/:id/reset-2fa` - Admin: reset a user's two-factor authentication and sign them out
- `POST /api/v1/ai/query` - Natural language financial query
- `POST /api/v1/ai/query/stream` - Streaming financial query (SSE)
- `GET /api/v1/ai/configs` - List AI provider configurations
- `POST /api/v1/ai/configs` - Add AI provider
- `POST /api/v1/ai/configs/:id/test` - Test AI provider connection
- `GET /api/v1/ai/usage` - AI usage summary
- `GET /api/v1/ai/status` - AI feature availability
- `GET /api/v1/built-in-reports/*` - Pre-aggregated reports
- `POST /api/v1/mcp` - MCP (Model Context Protocol) endpoint, serving revision 2026-07-28 and the 2025-era revisions
- `GET /api/v1/auth/tokens` - List personal access tokens
- `POST /api/v1/auth/tokens` - Create personal access token
- `GET /api/v1/health/live` - Liveness probe
- `GET /api/v1/health/ready` - Readiness probe

## Database Schema

Main tables:
- **users** / **user_preferences**: User accounts and settings
- **trusted_devices**: 2FA trusted browser tokens
- **refresh_tokens**: JWT refresh token rotation
- **personal_access_tokens**: API tokens for MCP and programmatic access
- **accounts**: Financial accounts (bank, credit, investment)
- **transactions** / **transaction_splits**: Financial transactions
- **categories**: Hierarchical transaction categories
- **payees**: Payees with default category auto-assignment
- **currencies** / **exchange_rates**: Currency definitions and historical rates
- **scheduled_transactions** / **scheduled_transaction_overrides**: Recurring payments
- **securities** / **security_prices** / **holdings**: Stocks, price history, and positions
- **investment_transactions**: Buy/sell/dividend transactions
- **budgets** / **budget_categories** / **budget_periods**: Budget planner and tracking
- **monthly_account_balances**: Net worth snapshots
- **custom_reports**: User-defined report configurations
- **ai_provider_configs**: Per-user AI provider settings (encrypted API keys)
- **ai_usage_logs**: AI query usage tracking (tokens, duration, provider)
- **ai_insights**: AI-generated spending insights and anomaly detection

## Security Notes

- Swagger/OpenAPI is **disabled in production**
- JWT tokens stored in httpOnly cookies with refresh token rotation
- TOTP 2FA with trusted device tokens (SHA256-hashed, httpOnly cookies)
- Personal access tokens for API/MCP integration
- Rate limiting enabled on authentication endpoints
- Admin role required for user management operations
- Always use HTTPS in production
- Generate strong JWT secrets (`openssl rand -base64 32`)

## License

AGPL-3.0 License - See LICENSE file for details.
