import { describe, it, expect } from 'vitest';
import enTours from '@/i18n/messages/en/tours.json';
import { ALL_TOURS } from './registry';
import {
  TOUR_AREA_ORDER,
  TOUR_AREA_RANK,
  groupToursByArea,
  tourStepCount,
  tourTitleKey,
} from './catalog';
import type { TourArea, TourDefinition } from './types';

function lookup(catalog: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      catalog,
    );
}

describe('TOUR_AREA_ORDER', () => {
  it('lists every area exactly once, in rank order', () => {
    const areas = Object.keys(TOUR_AREA_RANK) as TourArea[];
    expect([...TOUR_AREA_ORDER].sort()).toEqual([...areas].sort());
    expect(new Set(TOUR_AREA_ORDER).size).toBe(TOUR_AREA_ORDER.length);
    const ranks = TOUR_AREA_ORDER.map((area) => TOUR_AREA_RANK[area]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('ranks every area a registered tour uses', () => {
    for (const tour of ALL_TOURS) {
      expect(TOUR_AREA_ORDER).toContain(tour.area);
    }
  });
});

describe('groupToursByArea', () => {
  it('returns every tour exactly once', () => {
    const grouped = groupToursByArea(ALL_TOURS).flatMap((g) => g.tours);
    expect(grouped.map((t) => t.id).sort()).toEqual(
      ALL_TOURS.map((t) => t.id).sort(),
    );
  });

  it('omits areas with no tours', () => {
    const areasWithTours = new Set(ALL_TOURS.map((t) => t.area));
    for (const group of groupToursByArea(ALL_TOURS)) {
      expect(areasWithTours.has(group.area)).toBe(true);
      expect(group.tours.length).toBeGreaterThan(0);
    }
  });

  it('orders groups by area rank and keeps registry order within a group', () => {
    const groups = groupToursByArea(ALL_TOURS);
    const ranks = groups.map((g) => TOUR_AREA_RANK[g.area]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    for (const group of groups) {
      const registryOrder = ALL_TOURS.filter((t) => t.area === group.area).map(
        (t) => t.id,
      );
      expect(group.tours.map((t) => t.id)).toEqual(registryOrder);
    }
  });

  it('groups a hand-built set without inventing or dropping tours', () => {
    const fake = (id: string, area: TourArea): TourDefinition => ({
      id,
      area,
      i18nPrefix: `fake.${id}`,
      steps: [],
    });
    const groups = groupToursByArea([
      fake('b', 'settings'),
      fake('a', 'intro'),
      fake('c', 'settings'),
    ]);
    expect(groups.map((g) => [g.area, g.tours.map((t) => t.id)])).toEqual([
      ['intro', ['a']],
      ['settings', ['b', 'c']],
    ]);
  });
});

describe('tourTitleKey', () => {
  it('resolves against the English catalog for every registered tour', () => {
    for (const tour of ALL_TOURS) {
      const value = lookup(enTours, tourTitleKey(tour));
      expect(
        typeof value === 'string' && value.length > 0,
        `missing tours.${tourTitleKey(tour)} for ${tour.id}`,
      ).toBe(true);
    }
  });

  it('names the introduction tour rather than pitching it', () => {
    // The What's New offer row deliberately uses `offer.introTitle` ("New
    // here? ...") instead. A catalog wants the name.
    const intro = ALL_TOURS.find((t) => t.id === 'intro/basics');
    expect(intro).toBeDefined();
    expect(tourTitleKey(intro!)).toBe('intro.basics.title');
  });
});

describe('tourStepCount', () => {
  it('reports the authored step count', () => {
    for (const tour of ALL_TOURS) {
      expect(tourStepCount(tour)).toBe(tour.steps.length);
      expect(tourStepCount(tour)).toBeGreaterThan(0);
    }
  });
});
