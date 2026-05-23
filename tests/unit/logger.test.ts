import { setLogger, getLogger, Logger } from '../../src/logger';

describe('Logger', () => {
  afterEach(() => {
    // Reset to silent logger after each test
    setLogger({ debug() {}, info() {}, warn() {}, error() {} } as Logger);
  });

  test('default logger is silent (does not throw)', () => {
    const logger = getLogger();
    expect(() => logger.debug('test')).not.toThrow();
    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.warn('test')).not.toThrow();
    expect(() => logger.error('test')).not.toThrow();
  });

  test('setLogger replaces the logger', () => {
    const calls: string[] = [];
    const customLogger: Logger = {
      debug: (...args) => calls.push('debug:' + args.join(',')),
      info: (...args) => calls.push('info:' + args.join(',')),
      warn: (...args) => calls.push('warn:' + args.join(',')),
      error: (...args) => calls.push('error:' + args.join(',')),
    };

    setLogger(customLogger);
    const logger = getLogger();

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(calls).toEqual(['debug:d', 'info:i', 'warn:w', 'error:e']);
  });

  test('getLogger returns the same instance after setLogger', () => {
    const customLogger: Logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    setLogger(customLogger);
    const a = getLogger();
    const b = getLogger();
    expect(a).toBe(b);
    expect(a).toBe(customLogger);
  });

  test('custom logger with multiple arguments', () => {
    const received: unknown[][] = [];
    setLogger({
      debug: (...args) => { received.push(args); },
      info: () => {},
      warn: () => {},
      error: () => {},
    });

    getLogger().debug('msg', { detail: 1 }, 42);
    expect(received[0]).toEqual(['msg', { detail: 1 }, 42]);
  });

  test('custom logger can be partial / no-op', () => {
    setLogger({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    });

    expect(() => getLogger().info('anything')).not.toThrow();
    expect(() => getLogger().error('anything')).not.toThrow();
  });
});
