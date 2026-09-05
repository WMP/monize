import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_DETAIL_VIEWS,
  DETAIL_ACCOUNT_TYPES,
  hasAccountDetailView,
  resolveAccountDetailView,
} from './account-detail-views';
import type { AccountType } from '@/types/account';

describe('account detail view registry', () => {
  it('derives the eligible-type list from the registry itself', () => {
    // The list is what the row action and the tour requirement read; deriving
    // it is what keeps them describing the same set of pages.
    expect([...DETAIL_ACCOUNT_TYPES].sort()).toEqual(
      Object.keys(ACCOUNT_DETAIL_VIEWS).sort(),
    );
  });

  it('answers the eligibility question the same way the resolver does', () => {
    for (const type of DETAIL_ACCOUNT_TYPES) {
      expect(resolveAccountDetailView(type)).not.toBeNull();
      expect(hasAccountDetailView(type)).toBe(true);
    }
  });

  it('treats an unregistered type as having no detail page', () => {
    expect(resolveAccountDetailView('NOT_A_TYPE' as AccountType)).toBeNull();
    expect(hasAccountDetailView('NOT_A_TYPE' as AccountType)).toBe(false);
  });

  it('treats a missing type as having no detail page', () => {
    // An account read back from an API that omitted the field must not be
    // counted as something the user can open Details on.
    expect(hasAccountDetailView(undefined)).toBe(false);
    expect(hasAccountDetailView(null)).toBe(false);
  });
});
