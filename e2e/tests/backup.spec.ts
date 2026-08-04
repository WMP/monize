import { test, expect } from '../fixtures';
import { createAccount } from '../helpers/factories';
import { uniqueId } from '../helpers/api';

// Backup & restore. Export downloads a backup of all the user's data.
//
// Backups are encrypted with the user's own password wherever the server can
// keep a copy of it, which needs AI_ENCRYPTION_KEY -- and docker-compose.e2e.yml
// deliberately leaves that empty, so in this environment the download is the
// plain gzipped JSON and there is no password prompt. The encrypted path is
// covered by the backend specs.
//
// The restore round-trip wipes and replaces all data; driving it end-to-end in
// a browser is deferred (see ROADMAP Phase 3.4) -- the wipe appears to
// invalidate the active session, so asserting the restored data in the same
// page session isn't reliable. Restore is covered by backend tests.
test.describe('Backup & restore', () => {
  test('exports a backup file', async ({ authedPage: page, api }) => {
    await createAccount(api, { name: `Backup ${uniqueId()}` });

    await page.goto('/settings');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Backup' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/monize-backup.*\.(json\.gz|gz)/);
  });

  test('hides automatic backup settings from a non-admin', async ({
    authedPage: page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByText('Create Backup')).toBeVisible();

    // Automatic backups are configured by an administrator and applied to
    // everyone else; a plain user has nothing to set here.
    await expect(page.getByText('Automatic Backup')).toHaveCount(0);
  });

  test('shows automatic backup settings to an admin', async ({ adminPage }) => {
    await adminPage.goto('/settings');

    await expect(
      adminPage.getByRole('heading', { name: 'Automatic Backup' }),
    ).toBeVisible();
  });
});
