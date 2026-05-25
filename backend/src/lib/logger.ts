import pino from 'pino';
import { getConfig } from './config.js';

const cfg = getConfig();

export const logger = pino({
  level: cfg.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    cfg.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});
