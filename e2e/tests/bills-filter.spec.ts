import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import {
  createAccount,
  createCategory,
  createPayee,
} from '../helpers/factories';
import { ApiClient, uniqueId } from '../helpers/api';

// E2E coverage for filtering the Bills & Deposits list by Name, Payee,
// Account, and Category. Preconditions are seeded through the API; behaviour
// is driven through the BillsFilterPanel UI. Each test gets a fresh user
// (see fixtures), so data is seeded per-test and needs no cleanup.

interface SeededSchedule {
  id: string;
  name: string;
}

// The shared createScheduledTransaction factory does not expose categoryId /
// payeeId, both of which this feature filters on, so post directly here.
function seedSchedule(
  api: ApiClient,
  data: {
    accountId: string;
    name: string;
    amount?: number;
    categoryId?: string;
    payeeId?: string;
    payeeName?: string;
  },
): Promise<SeededSchedule> {
  return api.post<SeededSchedule>('/scheduled-transactions', {
    accountId: data.accountId,
    name: data.name,
    amount: data.amount ?? -100,
    currencyCode: 'USD',
    frequency: 'MONTHLY',
    nextDueDate: new Date().toISOString().slice(0, 10),
    ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
    ...(data.payeeId !== undefined ? { payeeId: data.payeeId } : {}),
    ...(data.payeeName !== undefined ? { payeeName: data.payeeName } : {}),
  });
}

// Open the (initially collapsed) filter panel.
function expandFilters(page: Page) {
  return page.getByRole('button', { name: /Filters/ }).click();
}

// Open a MultiSelect (identified by its placeholder) and tick an option.
async function selectOption(page: Page, placeholder: string, optionName: string) {
  await page.getByRole('button', { name: placeholder }).click();
  await page.getByRole('checkbox', { name: optionName }).check();
  // The dropdown closes on outside click; click the page heading so it does
  // not overlay subsequent list assertions.
  await page.getByRole('heading', { name: 'Bills & Deposits', level: 1 }).click();
}

test.describe('Bills & Deposits filtering', () => {
  test('filters the list by name', async ({ authedPage: page, api }) => {
    const account = await createAccount(api);
    const alpha = `Alpha Rent ${uniqueId()}`;
    const bravo = `Bravo Net ${uniqueId()}`;
    await seedSchedule(api, { accountId: account.id, name: alpha });
    await seedSchedule(api, { accountId: account.id, name: bravo });

    await page.goto('/bills');
    await expect(page.locator('tr', { hasText: alpha })).toBeVisible();
    await expect(page.locator('tr', { hasText: bravo })).toBeVisible();

    await expandFilters(page);
    await page.getByPlaceholder('Search by name...').fill('Alpha Rent');

    await expect(page.locator('tr', { hasText: alpha })).toBeVisible();
    await expect(page.locator('tr', { hasText: bravo })).toHaveCount(0);
  });

  test('filters the list by account', async ({ authedPage: page, api }) => {
    const acctA = await createAccount(api, { name: `Filter Acct A ${uniqueId()}` });
    const acctB = await createAccount(api, { name: `Filter Acct B ${uniqueId()}` });
    const alpha = `Alpha ${uniqueId()}`;
    const bravo = `Bravo ${uniqueId()}`;
    await seedSchedule(api, { accountId: acctA.id, name: alpha });
    await seedSchedule(api, { accountId: acctB.id, name: bravo });

    await page.goto('/bills');
    await expandFilters(page);
    await selectOption(page, 'All accounts', acctB.name);

    await expect(page.locator('tr', { hasText: bravo })).toBeVisible();
    await expect(page.locator('tr', { hasText: alpha })).toHaveCount(0);
  });

  test('filters the list by category', async ({ authedPage: page, api }) => {
    const account = await createAccount(api);
    const catA = await createCategory(api, { name: `Filter Cat A ${uniqueId()}` });
    const catB = await createCategory(api, { name: `Filter Cat B ${uniqueId()}` });
    const alpha = `Alpha ${uniqueId()}`;
    const bravo = `Bravo ${uniqueId()}`;
    await seedSchedule(api, { accountId: account.id, name: alpha, categoryId: catA.id });
    await seedSchedule(api, { accountId: account.id, name: bravo, categoryId: catB.id });

    await page.goto('/bills');
    await expandFilters(page);
    await selectOption(page, 'All categories', catA.name);

    await expect(page.locator('tr', { hasText: alpha })).toBeVisible();
    await expect(page.locator('tr', { hasText: bravo })).toHaveCount(0);
  });

  test('filters the list by payee', async ({ authedPage: page, api }) => {
    const account = await createAccount(api);
    const payeeA = await createPayee(api, { name: `Filter Payee A ${uniqueId()}` });
    const payeeB = await createPayee(api, { name: `Filter Payee B ${uniqueId()}` });
    const alpha = `Alpha ${uniqueId()}`;
    const bravo = `Bravo ${uniqueId()}`;
    await seedSchedule(api, {
      accountId: account.id, name: alpha, payeeId: payeeA.id, payeeName: payeeA.name,
    });
    await seedSchedule(api, {
      accountId: account.id, name: bravo, payeeId: payeeB.id, payeeName: payeeB.name,
    });

    await page.goto('/bills');
    await expandFilters(page);
    await selectOption(page, 'All payees', payeeB.name);

    await expect(page.locator('tr', { hasText: bravo })).toBeVisible();
    await expect(page.locator('tr', { hasText: alpha })).toHaveCount(0);
  });

  test('shows an active filter count and clears all filters', async ({ authedPage: page, api }) => {
    const acctA = await createAccount(api, { name: `Clear Acct A ${uniqueId()}` });
    const acctB = await createAccount(api, { name: `Clear Acct B ${uniqueId()}` });
    const alpha = `Alpha Rent ${uniqueId()}`;
    const bravo = `Bravo Net ${uniqueId()}`;
    await seedSchedule(api, { accountId: acctA.id, name: alpha });
    await seedSchedule(api, { accountId: acctB.id, name: bravo });

    await page.goto('/bills');
    await expandFilters(page);

    await page.getByPlaceholder('Search by name...').fill('Alpha Rent');
    await selectOption(page, 'All accounts', acctA.name);

    // Two active filter groups -> count badge of 2 on the Filters header,
    // and only Alpha remains.
    await expect(page.getByRole('button', { name: /Filters/ })).toContainText('2');
    await expect(page.locator('tr', { hasText: bravo })).toHaveCount(0);

    await page.getByText('Clear', { exact: true }).click();

    // Both rows return once filters are cleared.
    await expect(page.locator('tr', { hasText: alpha })).toBeVisible();
    await expect(page.locator('tr', { hasText: bravo })).toBeVisible();
  });
});
