import pino from 'pino';

export function createLogger({ level = 'info', pretty = false } = {}) {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.accessToken',
        '*.refreshToken',
      ],
      censor: '[redacted]',
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  });
}
