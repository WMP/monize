import { describe, it, expect } from 'vitest';
import { assertedClientAddress } from './client-address';

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe('assertedClientAddress', () => {
  it('prefers X-Real-IP, the single-address convention', () => {
    expect(
      assertedClientAddress(
        headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9' }),
      ),
    ).toBe('203.0.113.7');
  });

  /**
   * The regression. The predecessor read X-Real-IP and nothing else, so every
   * deployment behind an edge that sets only X-Forwarded-For -- Traefik, most
   * cloud load balancers -- fell through to a hardcoded `127.0.0.1`.
   */
  it('falls back to X-Forwarded-For when no X-Real-IP was set', () => {
    expect(
      assertedClientAddress(headers({ 'x-forwarded-for': '198.51.100.9' })),
    ).toBe('198.51.100.9');
  });

  // Each hop appends the peer it heard from, so the originating client is the
  // head of the list, not the tail.
  it('reads the first entry of a forwarded chain, not the last', () => {
    expect(
      assertedClientAddress(
        headers({ 'x-forwarded-for': '198.51.100.9, 10.0.0.2, 10.0.0.3' }),
      ),
    ).toBe('198.51.100.9');
  });

  it('trims the entry, since the chain is written with spaces', () => {
    expect(
      assertedClientAddress(headers({ 'x-forwarded-for': ' 198.51.100.9 ,10.0.0.2' })),
    ).toBe('198.51.100.9');
  });

  it('keeps an IPv6 address whole rather than splitting on its colons', () => {
    expect(assertedClientAddress(headers({ 'x-real-ip': '2001:db8::1' }))).toBe(
      '2001:db8::1',
    );
  });

  /**
   * Unknown is a state, and it is the whole reason this returns `null`: the
   * caller forwards no `X-Forwarded-For` at all rather than a placeholder, so
   * the backend records "we could not determine one" instead of an address
   * nobody was at.
   */
  it.each([
    ['no headers at all', {}],
    ['an empty X-Real-IP', { 'x-real-ip': '' }],
    ['a whitespace X-Forwarded-For', { 'x-forwarded-for': '   ' }],
    ['an empty leading entry', { 'x-forwarded-for': ', 10.0.0.2' }],
  ])('answers null for %s', (_name, entries) => {
    expect(assertedClientAddress(headers(entries))).toBeNull();
  });

  // An empty X-Real-IP must not shadow a usable chain: the header being present
  // is not the same as it carrying an address.
  it('falls through an empty X-Real-IP to the forwarded chain', () => {
    expect(
      assertedClientAddress(
        headers({ 'x-real-ip': '', 'x-forwarded-for': '198.51.100.9' }),
      ),
    ).toBe('198.51.100.9');
  });
});
