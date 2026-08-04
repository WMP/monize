import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  createInvestmentAccountPair,
  createSecurity,
  type CreatedSecurity,
} from '../helpers/factories';
import type { ApiClient } from '../helpers/api';

// The GEM strategy report: saving the configuration, moving between scenarios,
// and recording that the operation was carried out. These are the three things a
// user does on this page that write to the server, and none of them had browser
// coverage -- the component suites drive them against a mocked API, so nothing
// exercised the form, the switcher and the mark-executed button against the real
// routes, the real materialization and the real read model.
//
// Prices are seeded through `POST /securities/:id/prices` rather than left to the
// quote provider: the strategy needs a close at the momentum window's start and
// one at the period boundary before it will evaluate anything, and a test that
// depends on Yahoo answering is not a test. The symbols are per-user random, so
// the configuration save's own provider backfill finds nothing for them and
// leaves these closes alone.

/** ISO date of the last day of the month before `from`. */
function previousMonthEnd(from: Date): string {
  const end = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 0, 0, 0, 0),
  );
  return end.toISOString().slice(0, 10);
}

/** ISO date `months` before `date`, clamped to the target month's last day. */
function monthsBefore(date: string, months: number): string {
  const source = new Date(`${date}T00:00:00Z`);
  const day = source.getUTCDate();
  const shifted = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth() - months, 1),
  );
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted.toISOString().slice(0, 10);
}

const PERIOD_END = previousMonthEnd(new Date());
const WINDOW_START = monthsBefore(PERIOD_END, 12);

/**
 * A security with exactly the two closes the momentum window needs.
 *
 * The boundary close is also what settles the period: a span is priceable only
 * once the series holds an observation dated at or after its far boundary, and a
 * close struck exactly on it satisfies that.
 */
async function pricedSecurity(
  api: ApiClient,
  endClose: number,
): Promise<CreatedSecurity> {
  const security = await createSecurity(api, { securityType: 'ETF' });
  await api.post(`/securities/${security.id}/prices`, {
    priceDate: WINDOW_START,
    closePrice: 100,
  });
  await api.post(`/securities/${security.id}/prices`, {
    priceDate: PERIOD_END,
    closePrice: endClose,
  });
  return security;
}

/**
 * A configured strategy that evaluates to RISK-ON with the US leg winning: US
 * +20%, developed ex-US +10%, emerging +5%, and a safe asset up 1% for the
 * absolute test to clear.
 */
async function configuredStrategy(api: ApiClient) {
  const pair = await createInvestmentAccountPair(api);
  const [us, exUs, em, safe] = await Promise.all([
    pricedSecurity(api, 120),
    pricedSecurity(api, 110),
    pricedSecurity(api, 105),
    pricedSecurity(api, 101),
  ]);

  await api.put('/strategies/gem', {
    accountIds: [pair.brokerageAccount.id],
    cadence: 'MONTHLY',
    lookbackMonths: 12,
    assets: [
      { role: 'US_EQUITY', securityId: us.id },
      { role: 'EX_US_EQUITY', securityId: exUs.id },
      { role: 'EM_EQUITY', securityId: em.id },
      { role: 'SAFE', securityId: safe.id },
    ],
  });

  return { pair, us, exUs, em, safe };
}

/**
 * The report is on screen once its tab bar is.
 *
 * Not the page title: the `<h1>` is the *scenario* name ("GEM" by default, or
 * whatever the user called it), and "GEM Strategy" is breadcrumb text rather
 * than a heading. The tab bar is named, is present in every state including
 * first-run, and only renders once the read model has arrived -- which is the
 * thing these tests need to wait for.
 */
function reportReady(page: Page) {
  return expect(
    page.getByRole('tablist', { name: 'GEM strategy sections' }),
  ).toBeVisible({ timeout: 20000 });
}

test.describe('GEM strategy report', () => {
  test('renders the report for a configured strategy', async ({
    authedPage: page,
    api,
  }) => {
    const { us } = await configuredStrategy(api);
    await page.goto('/reports/gem-strategy');

    await reportReady(page);
    // The signal materialized from the seeded closes, and it names the winner.
    await expect(page.getByText(us.symbol).first()).toBeVisible({
      timeout: 20000,
    });
  });

  test('saves a configuration change and reflects it in the header', async ({
    authedPage: page,
    api,
  }) => {
    await configuredStrategy(api);
    await page.goto('/reports/gem-strategy');
    await reportReady(page);

    await page.getByRole('tab', { name: 'Settings' }).click();
    const cadence = page.getByLabel('Evaluation frequency');
    await expect(cadence).toBeVisible({ timeout: 20000 });
    await cadence.selectOption('QUARTERLY');

    await page.getByRole('button', { name: 'Save configuration' }).click();

    await expect(
      page.getByText('Strategy configuration saved.'),
    ).toBeVisible({ timeout: 20000 });
    // The save answers with the re-evaluated report, which the page adopts --
    // so the header, outside the form, shows the new cadence without a reload.
    await expect(
      page.getByText(/Evaluation frequency: Quarterly/i),
    ).toBeVisible({ timeout: 20000 });
  });

  test('switches between scenarios from the header switcher', async ({
    authedPage: page,
    api,
  }) => {
    await configuredStrategy(api);
    // A second scenario, so the switcher has somewhere to go. It is hidden until
    // there is more than one.
    await api.post('/strategies/gem', { name: 'E2E second scenario' });

    await page.goto('/reports/gem-strategy');
    await reportReady(page);

    // The default scenario is the one on screen to begin with.
    const currentScenario = page.getByRole('heading', { level: 1 });
    await expect(currentScenario).toHaveText('GEM');

    await page.getByRole('button', { name: 'Switch scenario' }).click();
    await page.getByText('E2E second scenario').first().click();

    // The page is now a report *of* the scenario picked -- asserted on the
    // heading, which is the scenario's own name. Asserting that the text is
    // visible somewhere would have passed without the click: the switcher had
    // already listed it.
    await expect(currentScenario).toHaveText('E2E second scenario', {
      timeout: 20000,
    });
  });

  test('records the operation as executed', async ({
    authedPage: page,
    api,
  }) => {
    // The strategy accounts hold nothing, so the signal asks for the opening
    // purchase and the action is required.
    await configuredStrategy(api);
    await page.goto('/reports/gem-strategy');

    const markExecuted = page.getByRole('button', {
      name: 'Mark as executed',
    });
    await expect(markExecuted).toBeVisible({ timeout: 20000 });
    await markExecuted.click();

    await expect(
      page.getByText('Operation marked as executed.'),
    ).toBeVisible({ timeout: 20000 });
    // The response is the refreshed report, so the flag is on screen without a
    // reload: the card now says the accounts still do not match what was
    // reported as done.
    await expect(
      page.getByText(/You marked this as done/i),
    ).toBeVisible({ timeout: 20000 });
  });

  test('offers no signal to act on before anything is configured', async ({
    authedPage: page,
  }) => {
    // The first-run state, which must not invent numbers: no strategy, no
    // accounts, no instruments.
    await page.goto('/reports/gem-strategy');

    await reportReady(page);
    await expect(page.getByText('No signal yet')).toBeVisible({
      timeout: 20000,
    });
  });
});
