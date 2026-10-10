import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses defaults when no environment variables are set', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '0.0.0.0',
      maxFileSizeBytes: 200 * 1024 * 1024,
      logLevel: 'info',
    });
  });

  it('reads values from the environment', () => {
    expect(
      loadConfig({
        PORT: '8080',
        HOST: '127.0.0.1',
        MAX_FILE_SIZE_MB: '50',
        LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      port: 8080,
      host: '127.0.0.1',
      maxFileSizeBytes: 50 * 1024 * 1024,
      logLevel: 'debug',
    });
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', '80.5'],
    ['MAX_FILE_SIZE_MB', '-1'],
    ['MAX_FILE_SIZE_MB', '0'],
    ['MAX_FILE_SIZE_MB', 'lots'],
    ['LOG_LEVEL', 'loud'],
  ])('rejects %s=%s with a helpful message', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(name);
  });
});
