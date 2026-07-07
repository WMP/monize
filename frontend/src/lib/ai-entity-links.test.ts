import { describe, it, expect } from 'vitest';
import { isMonizeHref, resolveEntityHref } from './ai-entity-links';

const uuid = '123e4567-e89b-42d3-a456-426614174000';

describe('resolveEntityHref', () => {
  it('maps an account link to the transactions page with accountStatus=all', () => {
    expect(resolveEntityHref(`monize://account/${uuid}`)).toBe(
      `/transactions?accountId=${uuid}&accountStatus=all`,
    );
  });

  it('maps a payee link to a payee filter', () => {
    expect(resolveEntityHref(`monize://payee/${uuid}`)).toBe(
      `/transactions?payeeId=${uuid}`,
    );
  });

  it('maps a category link to a category filter', () => {
    expect(resolveEntityHref(`monize://category/${uuid}`)).toBe(
      `/transactions?categoryId=${uuid}`,
    );
  });

  it('maps a transaction link to the highlight deep link', () => {
    expect(resolveEntityHref(`monize://transaction/${uuid}`)).toBe(
      `/transactions?targetTransactionId=${uuid}`,
    );
  });

  it('accepts an uppercase UUID and scheme', () => {
    expect(
      resolveEntityHref(`MONIZE://payee/${uuid.toUpperCase()}`),
    ).toBe(`/transactions?payeeId=${uuid.toUpperCase()}`);
  });

  it('rejects unknown entity types (including MCP resource URIs)', () => {
    expect(resolveEntityHref(`monize://security/${uuid}`)).toBeNull();
    expect(resolveEntityHref('monize://accounts')).toBeNull();
    expect(resolveEntityHref('monize://financial-summary')).toBeNull();
  });

  it('rejects malformed ids', () => {
    expect(resolveEntityHref('monize://payee/not-a-uuid')).toBeNull();
    expect(resolveEntityHref(`monize://payee/${uuid.slice(0, -1)}`)).toBeNull();
    expect(resolveEntityHref(`monize://payee/${uuid}0`)).toBeNull();
  });

  it('rejects trailing junk and query smuggling', () => {
    expect(resolveEntityHref(`monize://payee/${uuid}?x=1`)).toBeNull();
    expect(resolveEntityHref(`monize://payee/${uuid}/extra`)).toBeNull();
    expect(resolveEntityHref(`monize://payee/${uuid}#frag`)).toBeNull();
  });

  it('rejects non-monize and empty hrefs', () => {
    expect(resolveEntityHref('https://example.com')).toBeNull();
    expect(resolveEntityHref('/transactions?payeeId=x')).toBeNull();
    expect(resolveEntityHref('')).toBeNull();
    expect(resolveEntityHref(undefined)).toBeNull();
  });
});

describe('isMonizeHref', () => {
  it('detects the monize scheme case-insensitively', () => {
    expect(isMonizeHref(`monize://payee/${uuid}`)).toBe(true);
    expect(isMonizeHref('MoNiZe://anything')).toBe(true);
  });

  it('returns false for other schemes and missing hrefs', () => {
    expect(isMonizeHref('https://example.com')).toBe(false);
    expect(isMonizeHref('/transactions')).toBe(false);
    expect(isMonizeHref(undefined)).toBe(false);
  });
});
