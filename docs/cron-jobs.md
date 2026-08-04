# Cron Jobs

Cron jobs use the `@Cron()` decorator from `@nestjs/schedule`. They run in the API process (`ScheduleModule.forRoot()` in `backend/src/app.module.ts`); there is no separate scheduler process, and on k8s with more than one backend replica every replica fires every cron.

| Service | Schedule | Purpose |
|---------|----------|---------|
| `demo-reset.service` | Daily 4 AM, every 3 hours | Demo database reset |
| `ai-usage.service` | Daily 4 AM | AI usage cleanup |
| `ai-insights.service` | Daily 6 AM | Generate AI insights |
| `auth.service` | Daily 3 AM | Expired token cleanup |
| `scheduled-transactions.service` | Every 5 min past hour | Post due recurring transactions |
| `exchange-rate.service` | 5:05 PM ET weekdays | Fetch exchange rates (staggered after price refresh) |
| `scheduled-transactions.service` | 5:25 PM ET weekdays | Re-derive the account-currency estimate on foreign-currency schedules from the rates the 5:05 PM refresh just stored |
| `accounts.service` | Midnight daily | Account maintenance |
| `mortgage-reminder.service` | Daily 8 AM | Mortgage payment reminders |
| `bill-reminder.service` | Daily 8 AM | Bill payment reminders |
| `budget-period-cron.service` | 1st of month midnight | Create new budget periods |
| `budget-alert.service` | Daily 7 AM, Mon 7 AM, Daily 3 AM | Budget threshold alerts |
| `security-price.service` | 5 PM ET weekdays | Fetch security prices |
| `mny-staging.service` | Hourly | Delete expired staged import files (24 h TTL) |
| `mny-import-job.service` | Every 5 min | Fail import jobs whose worker stopped heartbeating |
| `auto-backup.service` | Hourly | Enrol every non-admin user on the default backup policy, then run the backups that are due |
