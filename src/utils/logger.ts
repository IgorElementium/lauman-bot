import { config } from './config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const logLevels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = logLevels[config.logging.level];

function log(level: LogLevel, message: string, data?: unknown): void {
  if (logLevels[level] < currentLevel) {
    return;
  }

  const timestamp = new Date().toISOString();
  const payload: Record<string, unknown> = {
    timestamp,
    level,
    message,
  };

  if (data) {
    payload.data = data;
  }

  const output = JSON.stringify(payload);

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (message: string, data?: unknown) => log('debug', message, data),
  info: (message: string, data?: unknown) => log('info', message, data),
  warn: (message: string, data?: unknown) => log('warn', message, data),
  error: (message: string, data?: unknown) => log('error', message, data),
};
