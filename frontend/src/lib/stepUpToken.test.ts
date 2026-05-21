import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  StepUpRequiredError,
  rethrowStepUpError,
  useStepUpTokenStore,
} from './stepUpToken';

describe('useStepUpTokenStore', () => {
  beforeEach(() => {
    useStepUpTokenStore.getState().clearAll();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useStepUpTokenStore.getState().clearAll();
  });

  it('returns null for an unknown purpose', () => {
    expect(useStepUpTokenStore.getState().getValid('nope')).toBeNull();
    expect(useStepUpTokenStore.getState().getExpiresAt('nope')).toBeNull();
  });

  it('stores a token and returns it within the expiry window', () => {
    const store = useStepUpTokenStore.getState();
    store.set('emergency-access', 'tok-1', new Date(Date.now() + 60_000).toISOString());
    expect(store.getValid('emergency-access')).toBe('tok-1');
    expect(store.getExpiresAt('emergency-access')).toBeGreaterThan(Date.now());
  });

  it('treats an unparseable expiresAt as a no-op', () => {
    const store = useStepUpTokenStore.getState();
    store.set('emergency-access', 'tok-x', 'not-a-date');
    expect(store.getValid('emergency-access')).toBeNull();
  });

  it('clears the entry when the timer fires', () => {
    const store = useStepUpTokenStore.getState();
    store.set('emergency-access', 'tok-1', new Date(Date.now() + 1000).toISOString());
    expect(store.getValid('emergency-access')).toBe('tok-1');

    vi.advanceTimersByTime(1500);
    expect(useStepUpTokenStore.getState().getValid('emergency-access')).toBeNull();
  });

  it('returns null + lazily clears when the token has expired without the timer firing', () => {
    const store = useStepUpTokenStore.getState();
    store.set('emergency-access', 'tok-1', new Date(Date.now() + 1000).toISOString());
    // Advance the wall clock but suppress timers so the setTimeout doesn't fire.
    vi.setSystemTime(Date.now() + 2000);
    expect(useStepUpTokenStore.getState().getValid('emergency-access')).toBeNull();
    expect(useStepUpTokenStore.getState().entries['emergency-access']).toBeUndefined();
  });

  it('returns null + lazily clears from getExpiresAt when the token is past expiry', () => {
    const store = useStepUpTokenStore.getState();
    store.set('emergency-access', 'tok-1', new Date(Date.now() + 1000).toISOString());
    vi.setSystemTime(Date.now() + 2000);
    expect(
      useStepUpTokenStore.getState().getExpiresAt('emergency-access'),
    ).toBeNull();
  });

  it('replaces an existing token + cancels the prior timer when set() is called again', () => {
    const store = useStepUpTokenStore.getState();
    store.set('emergency-access', 'tok-1', new Date(Date.now() + 1000).toISOString());
    store.set('emergency-access', 'tok-2', new Date(Date.now() + 5000).toISOString());

    // Advance past the first token's original expiry — the second one should still be alive.
    vi.advanceTimersByTime(2000);
    expect(useStepUpTokenStore.getState().getValid('emergency-access')).toBe(
      'tok-2',
    );
  });

  it('clear() removes the entry and cancels the timer', () => {
    const store = useStepUpTokenStore.getState();
    store.set('emergency-access', 'tok-1', new Date(Date.now() + 1000).toISOString());
    store.clear('emergency-access');
    expect(useStepUpTokenStore.getState().getValid('emergency-access')).toBeNull();
  });

  it('clear() on an unknown purpose is a no-op', () => {
    const store = useStepUpTokenStore.getState();
    store.set('emergency-access', 'tok-1', new Date(Date.now() + 1000).toISOString());
    store.clear('something-else');
    expect(useStepUpTokenStore.getState().getValid('emergency-access')).toBe(
      'tok-1',
    );
  });

  it('clearAll() removes every entry and cancels every timer', () => {
    const store = useStepUpTokenStore.getState();
    store.set('a', 'tA', new Date(Date.now() + 1000).toISOString());
    store.set('b', 'tB', new Date(Date.now() + 1000).toISOString());
    store.clearAll();
    expect(useStepUpTokenStore.getState().entries).toEqual({});
  });
});

describe('StepUpRequiredError', () => {
  it('captures purpose + reason and has the right name', () => {
    const err = new StepUpRequiredError('emergency-access', 'expired');
    expect(err.purpose).toBe('emergency-access');
    expect(err.reason).toBe('expired');
    expect(err.name).toBe('StepUpRequiredError');
    expect(err.message).toMatch(/expired/);
  });
});

describe('rethrowStepUpError', () => {
  it('converts STEP_UP_REQUIRED responses to StepUpRequiredError', () => {
    try {
      rethrowStepUpError({
        response: {
          status: 403,
          data: { code: 'STEP_UP_REQUIRED', purpose: 'emergency-access' },
        },
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(StepUpRequiredError);
      expect((err as StepUpRequiredError).reason).toBe('required');
    }
  });

  it('converts STEP_UP_EXPIRED', () => {
    try {
      rethrowStepUpError({
        response: {
          status: 403,
          data: { code: 'STEP_UP_EXPIRED', purpose: 'emergency-access' },
        },
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as StepUpRequiredError).reason).toBe('expired');
    }
  });

  it('converts STEP_UP_INVALID', () => {
    try {
      rethrowStepUpError({
        response: {
          status: 403,
          data: { code: 'STEP_UP_INVALID', purpose: 'emergency-access' },
        },
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as StepUpRequiredError).reason).toBe('invalid');
    }
  });

  it('defaults purpose to empty string when the server omits it', () => {
    try {
      rethrowStepUpError({
        response: { status: 403, data: { code: 'STEP_UP_REQUIRED' } },
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as StepUpRequiredError).purpose).toBe('');
    }
  });

  it('rethrows non-step-up errors unchanged', () => {
    const original = new Error('boom');
    expect(() => rethrowStepUpError(original)).toThrow(original);
  });

  it('rethrows responses with a different error code unchanged', () => {
    const error = {
      response: { status: 403, data: { code: 'CSRF_FAIL' } },
    };
    expect(() => rethrowStepUpError(error)).toThrow();
  });

  it('rethrows non-object thrown values unchanged', () => {
    expect(() => rethrowStepUpError('plain-string')).toThrow();
    expect(() => rethrowStepUpError(null)).toThrow();
  });

  it('rethrows objects that have no response field', () => {
    const error = { foo: 'bar' };
    expect(() => rethrowStepUpError(error)).toThrow();
  });
});
