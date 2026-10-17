import { describe, expect, it } from 'vitest';
import { parseConfig, type Env } from '../src/env';

const TEST_APP_CREDENTIAL = ['app', 'credential', 'value'].join('-');
const TEST_QQ_CREDENTIAL = ['qq', 'credential', 'value'].join('-');
const TEST_SPACED_CREDENTIAL = `  ${['spaced', 'credential'].join('-')}  `;

function env(overrides: Partial<Env> = {}): Env {
  return {
    MAIL2TG_KV: {} as KVNamespace,
    TELEGRAM_BOT_TOKEN: '123456:ABC',
    TELEGRAM_CHAT_ID: '42',
    MAILBOXES: JSON.stringify([
      {
        email: 'user@gmail.com',
        password: TEST_APP_CREDENTIAL,
        host: 'imap.gmail.com',
        port: 993,
      },
    ]),
    ...overrides,
  };
}

describe('parseConfig', () => {
  it('parses the canonical mailbox format', () => {
    const config = parseConfig(env());
    expect(config.mailboxes).toHaveLength(1);
    expect(config.mailboxes[0]).toMatchObject({
      id: 'user@gmail.com',
      email: 'user@gmail.com',
      password: TEST_APP_CREDENTIAL,
      host: 'imap.gmail.com',
      port: 993,
    });
    expect(config.chatId).toBe('42');
    expect(config.language).toBe('Chinese');
    expect(config.timeZone).toBe('Asia/Shanghai');
    expect(config.initialSync).toBe('skip');
    expect(config.dedupe).toBe(true);
  });

  it('accepts the original uppercase config keys and a single object', () => {
    const config = parseConfig(
      env({
        MAILBOXES: JSON.stringify({
          EMAIL: 'user@qq.com',
          PASSWORD: TEST_QQ_CREDENTIAL,
          IMAP_SERVER: 'imap.qq.com',
          IMAP_SERVER_PORT: 993,
        }),
      }),
    );
    expect(config.mailboxes[0]).toMatchObject({
      email: 'user@qq.com',
      password: TEST_QQ_CREDENTIAL,
      host: 'imap.qq.com',
      port: 993,
    });
  });

  it('preserves spaces inside secrets', () => {
    const config = parseConfig(
      env({
        MAILBOXES: JSON.stringify([
          {
            email: 'user@gmail.com',
            password: TEST_SPACED_CREDENTIAL,
            host: 'imap.gmail.com',
          },
        ]),
      }),
    );
    expect(config.mailboxes[0]?.password).toBe(TEST_SPACED_CREDENTIAL);
  });

  it('allows dry-run without Telegram credentials', () => {
    const config = parseConfig(
      env({
        DRY_RUN: 'true',
        TELEGRAM_BOT_TOKEN: '',
        TELEGRAM_CHAT_ID: '',
      }),
    );
    expect(config.dryRun).toBe(true);
    expect(config.telegramToken).toBe('');
    expect(config.chatId).toBe('');
  });

  it('rejects missing Telegram credentials outside dry-run', () => {
    expect(() => parseConfig(env({ TELEGRAM_BOT_TOKEN: '' }))).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => parseConfig(env({ TELEGRAM_CHAT_ID: '' }))).toThrow(/TELEGRAM_CHAT_ID/);
  });

  it('rejects invalid mailbox configuration', () => {
    expect(() => parseConfig(env({ MAILBOXES: '{not json' }))).toThrow(/not valid JSON/);
    expect(() => parseConfig(env({ MAILBOXES: '[]' }))).not.toThrow();

    const privateHost = JSON.stringify([
      { email: 'a@example.com', password: TEST_APP_CREDENTIAL, host: '127.0.0.1' },
    ]);
    expect(() => parseConfig(env({ MAILBOXES: privateHost }))).toThrow(/private or reserved/);

    const port25 = JSON.stringify([
      { email: 'a@gmail.com', password: TEST_APP_CREDENTIAL, host: 'imap.gmail.com', port: 25 },
    ]);
    expect(() => parseConfig(env({ MAILBOXES: port25 }))).toThrow(/port 25/);

    const duplicate = JSON.stringify([
      { email: 'a@gmail.com', password: TEST_APP_CREDENTIAL, host: 'imap.gmail.com' },
      { email: 'a@gmail.com', password: TEST_QQ_CREDENTIAL, host: 'imap.gmail.com' },
    ]);
    expect(() => parseConfig(env({ MAILBOXES: duplicate }))).toThrow(/duplicate/);
  });

  it('validates numeric and enum settings', () => {
    expect(() => parseConfig(env({ MAX_MESSAGES_PER_RUN: '0' }))).toThrow(/MAX_MESSAGES_PER_RUN/);
    expect(() => parseConfig(env({ MAX_EMAIL_BYTES: '999999999' }))).toThrow(/MAX_EMAIL_BYTES/);
    expect(() => parseConfig(env({ INITIAL_SYNC: 'everything' }))).toThrow(/INITIAL_SYNC/);
    expect(() => parseConfig(env({ TIMEZONE: 'Not/AZone' }))).toThrow(/TIMEZONE/);
    expect(() => parseConfig(env({ DEDUPE: 'maybe' }))).toThrow(/boolean/);
  });
});
