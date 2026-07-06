import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import {
  resolveDashboardLayout,
  DASHBOARD_WIDGETS,
  type DashboardWidgetEntry,
} from './widget-registry';

const noopRender = (): ReactNode => null;

const fakeRegistry: DashboardWidgetEntry[] = [
  { id: 'alpha', defaultOrder: 0, nameKey: 'widgetNames.alpha', render: noopRender },
  { id: 'beta', defaultOrder: 1, nameKey: 'widgetNames.beta', render: noopRender },
  { id: 'gamma', defaultOrder: 2, nameKey: 'widgetNames.gamma', render: noopRender },
];

const ids = (list: { entry: DashboardWidgetEntry }[]) => list.map((r) => r.entry.id);

describe('resolveDashboardLayout', () => {
  it('returns all registry widgets in default order, all visible, when saved is empty', () => {
    const resolved = resolveDashboardLayout([], fakeRegistry);
    expect(ids(resolved)).toEqual(['alpha', 'beta', 'gamma']);
    expect(resolved.every((r) => r.visible)).toBe(true);
  });

  it('treats undefined/null saved layout as empty (defaults)', () => {
    expect(ids(resolveDashboardLayout(undefined, fakeRegistry))).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(ids(resolveDashboardLayout(null, fakeRegistry))).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('honours saved order and appends registry widgets missing from it (in default order) as visible', () => {
    const resolved = resolveDashboardLayout(
      [
        { id: 'gamma', visible: true },
        { id: 'alpha', visible: true },
      ],
      fakeRegistry,
    );
    // saved order first, then the missing 'beta' appended
    expect(ids(resolved)).toEqual(['gamma', 'alpha', 'beta']);
    expect(resolved.find((r) => r.entry.id === 'beta')?.visible).toBe(true);
  });

  it('drops saved ids that are not in the registry', () => {
    const resolved = resolveDashboardLayout(
      [
        { id: 'ghost', visible: true },
        { id: 'beta', visible: false },
      ],
      fakeRegistry,
    );
    expect(ids(resolved)).toEqual(['beta', 'alpha', 'gamma']);
    expect(resolved.find((r) => r.entry.id === 'ghost')).toBeUndefined();
  });

  it('preserves the hidden (visible:false) flag from the saved layout', () => {
    const resolved = resolveDashboardLayout(
      [{ id: 'alpha', visible: false }],
      fakeRegistry,
    );
    expect(resolved.find((r) => r.entry.id === 'alpha')?.visible).toBe(false);
    // appended widgets stay visible
    expect(resolved.find((r) => r.entry.id === 'beta')?.visible).toBe(true);
  });

  it('ignores duplicate saved ids, keeping the first occurrence', () => {
    const resolved = resolveDashboardLayout(
      [
        { id: 'beta', visible: false },
        { id: 'beta', visible: true },
      ],
      fakeRegistry,
    );
    const betas = resolved.filter((r) => r.entry.id === 'beta');
    expect(betas).toHaveLength(1);
    expect(betas[0].visible).toBe(false);
  });

  it('uses the real DASHBOARD_WIDGETS registry by default', () => {
    const resolved = resolveDashboardLayout([]);
    expect(resolved).toHaveLength(DASHBOARD_WIDGETS.length);
    expect(resolved[0].entry.id).toBe('favourite-accounts');
    expect(ids(resolved)).toContain('favourite-reports');
  });

  it('gates investment widgets behind hasSecurities via available()', () => {
    const topMovers = DASHBOARD_WIDGETS.find((e) => e.id === 'top-movers');
    expect(topMovers?.available).toBeDefined();
    const ctx = { hasSecurities: false } as never;
    expect(topMovers?.available?.(ctx)).toBe(false);
    const ctx2 = { hasSecurities: true } as never;
    expect(topMovers?.available?.(ctx2)).toBe(true);
  });
});
