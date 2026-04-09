import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../../.env');

dotenv.config({ path: envPath });

export interface Config {
  telegram: {
    botToken: string;
    allowedChatIds: number[];
  };
  odoo: {
    url: string;
    db: string;
    username: string;
    apiKey: string;
  };
  claude: {
    apiKey: string;
    model: string;
    modelUpgrade: string;
  };
  whisper: {
    model: string;
    language: string;
  };
  bot: {
    mode: 'production' | 'test' | 'dry-run';
    pollIntervalMs: number;
    heartbeatIntervalMs: number;
    logRetentionDays: number;
  };
  alerts: {
    igorChatId?: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

function parseEnv<T>(name: string, defaultValue?: T): T {
  const value = process.env[name];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return (value || defaultValue) as T;
}

function parseIntEnv(name: string, defaultValue?: number): number {
  const value = parseEnv<string>(name, defaultValue?.toString());
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for ${name}: ${value}`);
  }
  return parsed;
}

function parseChatIds(value: string): number[] {
  return value
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));
}

export const config: Config = {
  telegram: {
    botToken: parseEnv<string>('TELEGRAM_BOT_TOKEN'),
    allowedChatIds: parseChatIds(parseEnv<string>('ALLOWED_CHAT_IDS')),
  },
  odoo: {
    url: parseEnv<string>('ODOO_URL', 'https://laumanrenovatie1.odoo.com'),
    db: parseEnv<string>('ODOO_DB', 'laumanrenovatie1'),
    username: parseEnv<string>('ODOO_USERNAME'),
    apiKey: parseEnv<string>('ODOO_API_KEY'),
  },
  claude: {
    apiKey: parseEnv<string>('ANTHROPIC_API_KEY'),
    model: parseEnv<string>('LLM_MODEL', 'claude-haiku-4-5-20251001'),
    modelUpgrade: parseEnv<string>(
      'LLM_MODEL_UPGRADE',
      'claude-sonnet-4-6-20250131'
    ),
  },
  whisper: {
    model: parseEnv<string>('WHISPER_MODEL', 'small'),
    language: parseEnv<string>('WHISPER_LANGUAGE', 'nl'),
  },
  bot: {
    mode: (parseEnv<string>('BOT_MODE', 'production') as any) || 'production',
    pollIntervalMs: parseIntEnv('POLL_INTERVAL_MS', 120000),
    heartbeatIntervalMs: parseIntEnv('HEARTBEAT_INTERVAL_MS', 1800000),
    logRetentionDays: parseIntEnv('LOG_RETENTION_DAYS', 90),
  },
  alerts: {
    igorChatId: process.env.IGOR_CHAT_ID
      ? parseIntEnv('IGOR_CHAT_ID')
      : undefined,
  },
  logging: {
    level: (parseEnv<string>('LOG_LEVEL', 'info') as any) || 'info',
  },
};

export function validateConfig(): void {
  if (config.telegram.allowedChatIds.length === 0) {
    throw new Error(
      'ALLOWED_CHAT_IDS must contain at least one chat ID (comma-separated)'
    );
  }
}
