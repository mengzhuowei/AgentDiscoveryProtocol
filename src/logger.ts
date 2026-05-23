export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

class SilentLogger implements Logger {
  debug(..._args: unknown[]): void {}
  info(..._args: unknown[]): void {}
  warn(..._args: unknown[]): void {}
  error(..._args: unknown[]): void {}
}

let _logger: Logger = new SilentLogger();

export function setLogger(logger: Logger): void {
  _logger = logger;
}

export function getLogger(): Logger {
  return _logger;
}
