import pino, { type Logger as PinoLogger } from 'pino';
import { getConfig } from './config.js';

let _logger: PinoLogger | undefined;
export function getLogger(): PinoLogger {
  if (!_logger) {
    const cfg = getConfig();
    _logger = pino({
      level: cfg.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: cfg.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } : undefined,
    });
  }
  return _logger;
}
export const logger = new Proxy({} as PinoLogger, {
  get(_, prop) {
    const instance = getLogger();
    const value = (instance as any)[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});
