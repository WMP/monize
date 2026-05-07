import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an object with error, warn, info, and debug methods', () => {
    const logger = createLogger('Test');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('error calls console.error with context tag', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('MyModule');
    logger.error('something failed');
    expect(spy).toHaveBeenCalledWith('[MyModule]', 'something failed');
  });

  it('warn calls console.warn with context tag', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createLogger('Auth');
    logger.warn('token expiring');
    expect(spy).toHaveBeenCalledWith('[Auth]', 'token expiring');
  });

  it('info calls console.info with context tag and extra args', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger('App');
    logger.info('initialized', { count: 1 });
    expect(spy).toHaveBeenCalledWith('[App]', 'initialized', { count: 1 });
  });

  it('each logger instance gets its own context tag', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const loggerA = createLogger('ServiceA');
    const loggerB = createLogger('ServiceB');
    loggerA.info('hello');
    loggerB.info('world');
    expect(spy).toHaveBeenCalledWith('[ServiceA]', 'hello');
    expect(spy).toHaveBeenCalledWith('[ServiceB]', 'world');
  });
});

describe('createLogger with debug level', () => {
  it('debug calls console.debug when NEXT_PUBLIC_LOG_LEVEL is debug', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_LOG_LEVEL = 'debug';
    const { createLogger: createLoggerDebug } = await import('./logger');
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logger = createLoggerDebug('DebugTest');
    logger.debug('trace message', { data: 1 });
    expect(spy).toHaveBeenCalledWith('[DebugTest]', 'trace message', { data: 1 });
    delete process.env.NEXT_PUBLIC_LOG_LEVEL;
    vi.resetModules();
  });
});
