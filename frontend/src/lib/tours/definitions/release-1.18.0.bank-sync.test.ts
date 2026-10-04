import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createTranslator } from 'use-intl';
import {
  RELEASE_1_18_MINOR,
  RELEASE_1_18_TOURS,
  RELEASE_1_18_BANK_SYNC_TOUR,
} from './release-1.18.0';
import { TOUR_ANCHORS } from '../anchors';
import { getReleaseTours, getTourById } from '../registry';
import { isTourOfferable } from '../requirements';
import { isStepReachable } from '../navigation';
import type { TourAnchorId } from '../anchors';

const tour = RELEASE_1_18_BANK_SYNC_TOUR;
const ANCHOR_VALUES = new Set<TourAnchorId>(Object.values(TOUR_ANCHORS));
const step = (id: string) => tour.steps.find((s) => s.id === id);

describe('bank sync release tour', () => {
  it('is a 1.18 release tour registered under a stable id', () => {
    expect(RELEASE_1_18_MINOR).toBe('1.18');
    expect(tour.id).toBe('release-1.18.0/bank-sync');
    expect(tour.version).toBe('1.18');
    expect(tour.area).toBe('settings');
    expect(tour.i18nPrefix).toBe('release.v1_18_0.bankSync');
    expect(RELEASE_1_18_TOURS).toContain(tour);
    expect(getTourById(tour.id)).toBe(tour);
    expect(getReleaseTours('1.18.2').map((t) => t.id)).toContain(tour.id);
    expect(getReleaseTours('1.17.0').map((t) => t.id)).not.toContain(tour.id);
  });

  it('walks where the settings are, the setup help, the credentials, connect, connections, link, preview, consent, then the two notification rows', () => {
    expect(tour.steps.map((s) => s.id)).toEqual([
      'welcome',
      'openSettings',
      'settingsHub',
      'helpWhat',
      'helpSteps',
      'credentials',
      'connect',
      'connections',
      'link',
      'preview',
      'consent',
      'notifications',
      'notificationsSync',
    ]);
  });

  it('shows where Settings is before the page: the header button, then the Bank sync card', () => {
    const header = step('openSettings');
    expect(header?.anchorId).toBe(TOUR_ANCHORS.navSettings);
    // Route-agnostic and passive: the button navigates, and a click advance
    // would race its own navigation. The phone has no header button.
    expect(header?.route).toBeUndefined();
    expect(header?.advance).toBeUndefined();
    expect(header?.skipOnMobile).toBe(true);
    expect(header?.fallbackWhenMissing).toBe(true);

    const hub = step('settingsHub');
    expect(hub?.route).toBe('/settings');
    expect(hub?.anchorId).toBe(TOUR_ANCHORS.settingsBankSyncCard);
    expect(hub?.advance).toEqual({ type: 'route', route: '/settings/bank-sync' });
    expect(hub?.fallbackWhenMissing).toBe(true);
  });

  it('opens the setup help first, holds it open for both of its steps, and points inside it', () => {
    const ids = tour.steps.map((s) => s.id);
    expect(ids.indexOf('helpWhat')).toBeLessThan(ids.indexOf('helpSteps'));
    expect(ids.indexOf('helpSteps')).toBeLessThan(ids.indexOf('credentials'));
    expect(step('helpWhat')?.anchorId).toBe(TOUR_ANCHORS.bankSyncHelpWhat);
    expect(step('helpSteps')?.anchorId).toBe(TOUR_ANCHORS.bankSyncHelpSteps);
    for (const id of ['helpWhat', 'helpSteps']) {
      expect(step(id)?.route).toBe('/settings/bank-sync');
      expect(step(id)?.openBankSyncHelp).toBe(true);
    }
    // The card step is about the form, so the help folds away again.
    expect(step('credentials')?.openBankSyncHelp).toBeUndefined();
  });

  it('references only declared anchors', () => {
    for (const s of tour.steps.filter((x) => x.anchorId !== null)) {
      expect(ANCHOR_VALUES.has(s.anchorId as TourAnchorId)).toBe(true);
    }
  });

  it('opens with a route-agnostic welcome', () => {
    const welcome = tour.steps[0];
    expect(welcome.id).toBe('welcome');
    expect(welcome.route).toBeUndefined();
    expect(welcome.routeMatch).toBeUndefined();
    expect(welcome.anchorId).toBeNull();
  });

  it('anchors the first three screens on blocks that render in every state', () => {
    const always = {
      credentials: TOUR_ANCHORS.bankSyncCredentials,
      connect: TOUR_ANCHORS.bankSyncConnectHeader,
      connections: TOUR_ANCHORS.bankSyncConnections,
    };
    for (const [id, anchor] of Object.entries(always)) {
      expect(step(id)?.route).toBe('/settings/bank-sync');
      expect(step(id)?.anchorId).toBe(anchor);
      // Nothing to fall back to: the anchor is there with no bank connected.
      expect(step(id)?.fallbackWhenMissing).toBeUndefined();
    }
  });

  it('gives the steps that need a connected bank a fallback instead of a skip', () => {
    const needsBank = {
      link: TOUR_ANCHORS.bankSyncAccountLink,
      preview: TOUR_ANCHORS.bankSyncAccountActions,
      consent: TOUR_ANCHORS.bankSyncConnectionConsent,
    };
    for (const [id, anchor] of Object.entries(needsBank)) {
      expect(step(id)?.route).toBe('/settings/bank-sync');
      expect(step(id)?.anchorId).toBe(anchor);
      expect(step(id)?.fallbackWhenMissing).toBe(true);
      expect(step(id)?.anchorTimeoutMs).toBeLessThanOrEqual(2000);
    }
  });

  it('ends on the two bank sync rows of the notification matrix, never the whole matrix', () => {
    expect(step('notifications')?.route).toBe('/settings');
    expect(step('notifications')?.anchorId).toBe(TOUR_ANCHORS.notificationBankConnectionsRow);
    expect(step('notificationsSync')?.route).toBe('/settings');
    expect(step('notificationsSync')?.anchorId).toBe(TOUR_ANCHORS.notificationBankSyncResultsRow);
    for (const s of tour.steps) {
      expect(s.anchorId).not.toBe(TOUR_ANCHORS.notificationChannelMatrix);
    }
  });

  it('pins every step to a static route the engine can navigate to', () => {
    for (const s of tour.steps) {
      expect(s.routeMatch).toBeUndefined();
      expect(s.requires).toBeUndefined();
      expect(isStepReachable(s, '/dashboard')).toBe(true);
    }
  });

  it('is owner-only: the bank sync endpoints refuse a delegate session', () => {
    expect(tour.requiresData).toBe('ownerView');
    const base = { transactionEntry: true, accountsExist: true, securitiesExist: true };
    expect(isTourOfferable(tour, { ...base, ownerView: true })).toBe(true);
    expect(isTourOfferable(tour, { ...base, ownerView: false })).toBe(false);
  });
});

describe('bank sync tour copy', () => {
  const messagesDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'i18n',
    'messages',
  );
  const locales = readdirSync(messagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    // A regional variant carries only the leaves that differ from its base.
    .filter((locale) => !['en-GB', 'en-US'].includes(locale));

  it.each(locales)('formats every step in "%s" without an ICU error', (locale) => {
    const messages = JSON.parse(
      readFileSync(join(messagesDir, locale, 'tours.json'), 'utf8'),
    );
    const t = createTranslator({ locale: 'en', messages, namespace: undefined });
    const translate = t as unknown as (key: string) => string;
    for (const s of tour.steps) {
      const base = `${tour.i18nPrefix}.steps.${s.id}`;
      expect(translate(`${base}.title`).length).toBeGreaterThan(0);
      expect(translate(`${base}.body`).length).toBeGreaterThan(0);
      if (s.fallbackWhenMissing) {
        expect(translate(`${base}.fallbackBody`).length).toBeGreaterThan(0);
      }
    }
    expect(translate('release.v1_18_0.bankSync.title').length).toBeGreaterThan(0);
  });

  it('names the controls the real screen shows, and keeps to short plain copy', () => {
    const messages = JSON.parse(
      readFileSync(join(messagesDir, 'en', 'tours.json'), 'utf8'),
    );
    const settings = JSON.parse(
      readFileSync(join(messagesDir, 'en', 'settings.json'), 'utf8'),
    ).bankSync;
    const t = createTranslator({ locale: 'en', messages, namespace: undefined });
    const body = (id: string) =>
      (t as unknown as (key: string) => string)(`${tour.i18nPrefix}.steps.${id}.body`);

    expect(body('credentials')).toContain(`**${settings.credentials.configure}**`);
    expect(body('credentials')).toContain(`**${settings.credentials.test}**`);
    expect(body('credentials')).toContain(`**${settings.credentials.help.show}**`);
    expect(body('connect')).toContain(`**${settings.connections.connect}**`);
    expect(body('connect')).toContain(`**${settings.connect.continue}**`);
    expect(body('connections')).toContain(`**${settings.connection.syncAll}**`);
    expect(body('connections')).toContain(`**${settings.connection.disconnect}**`);
    expect(body('link')).toContain(`**${settings.account.createNew}**`);
    expect(body('link')).toContain(`**${settings.connection.matchAccounts}**`);
    expect(body('preview')).toContain(`**${settings.account.syncNow}**`);
    expect(body('consent')).toContain(`**${settings.connection.renew}**`);
    expect(body('consent')).toContain(`**${settings.connection.expiresSoon}**`);
    expect(body('notificationsSync')).toContain(`**${settings.connection.notifySuccess}**`);
    const hub = JSON.parse(
      readFileSync(join(messagesDir, 'en', 'settings.json'), 'utf8'),
    ).page.bankSyncCard;
    expect(body('settingsHub')).toContain(`**${hub.title}**`);
    expect(body('openSettings')).toContain('**Settings**');
    // The outside service is a website, never an app the reader already owns or
    // a Windows-style control panel.
    expect(body('helpWhat')).toContain('not a program on your computer');
    for (const s of tour.steps) {
      for (const leaf of ['body', 'fallbackBody']) {
        const key = `${tour.i18nPrefix}.steps.${s.id}.${leaf}`;
        const text = t.has(key) ? (t as unknown as (k: string) => string)(key) : '';
        expect(text, key).not.toMatch(/control panel|your own Enable Banking/i);
      }
    }

    for (const s of tour.steps) {
      for (const leaf of ['title', 'body']) {
        const text = (t as unknown as (key: string) => string)(
          `${tour.i18nPrefix}.steps.${s.id}.${leaf}`,
        );
        expect(text).not.toContain('--');
      }
    }
  });
});
