const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  readonly port: number;
  readonly host: string;
  readonly maxFileSizeBytes: number;
  readonly logLevel: LogLevel;
}

const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_MAX_FILE_SIZE_MB = 200;
export const DEFAULT_MAX_FILE_SIZE_BYTES =
  DEFAULT_MAX_FILE_SIZE_MB * BYTES_PER_MB;

/**
 * Reads configuration from environment variables, falling back to defaults.
 * Throws on invalid values so misconfiguration fails at startup, not at
 * request time.
 *
 * - PORT (default 3000)
 * - HOST (default 0.0.0.0)
 * - MAX_FILE_SIZE_MB: upload limit in MiB (default 200)
 * - LOG_LEVEL: fatal | error | warn | info | debug | trace | silent (default info)
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Config {
  const port = parseInteger(env, 'PORT', 3000);
  if (port < 1 || port > 65535) {
    throw new Error(`PORT must be between 1 and 65535, got ${String(port)}`);
  }

  const maxFileSizeMb = parseInteger(
    env,
    'MAX_FILE_SIZE_MB',
    DEFAULT_MAX_FILE_SIZE_MB,
  );
  if (maxFileSizeMb < 1) {
    throw new Error(
      `MAX_FILE_SIZE_MB must be at least 1, got ${String(maxFileSizeMb)}`,
    );
  }

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!isLogLevel(logLevel)) {
    throw new Error(
      `LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${logLevel}"`,
    );
  }

  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    maxFileSizeBytes: maxFileSizeMb * BYTES_PER_MB,
    logLevel,
  };
}

function parseInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  defaultValue: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return defaultValue;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer, got "${raw}"`);
  }
  return Number(raw);
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}
