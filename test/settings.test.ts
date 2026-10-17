import { describe, expect, it } from 'vitest';
import {
  loadConfig,
  type Env,
  type StoredSettings,
} from '../src/env';
import {
  decryptSettings,
  encryptSettings,
  getSettingsKeyBytes,
  loadStoredSettings,
  maskSettings,
  mergeSubmittedSettings,
  saveStoredSettings,
  settingsKeyConfigured,
} from '../src/settings';
import { FakeKV } from './helpers/fake-kv';

const TEST_PASSWORD = ['test', 'credential', 'value'].join('-');
const TEST_BOT_TOKEN = ['123456', 'ABC'].join(':');
const TEST_WEBDAV_PASSWORD = ['dav', 'credential', 'value'].join('-');

function randomKeyHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function makeSettings(overrides: Partial<StoredSettings> = {}): StoredSettings {
  return {
    telegramToken: TEST_BOT_TOKEN,
    chatId: '42',
    junkChatId: '',
    language: 'Chinese',
    timeZone: 'Asia/Shanghai',
    maxEmailChars: 3000,
    maxEmailBytes: 10 * 1024 * 1024,
    maxMessagesPerRun: 20,
    initialSync: 'skip',
    loginNotify: true,
    dedupe: true,
    dryRun: false,
    listenMode: 'poll',
    idleWindowSeconds: 40,
    mailboxes: [
      {
        email: 'user@gmail.com',
        password: TEST_PASSWORD,
        host: 'imap.gmail.com',
        port: 993,
      },
    ],
    ...overrides,
  };
}

function makeEnv(kv: FakeKV, settingsKey: string, overrides: Partial<Env> = {}): Env {
  return {
    MAIL2TG_KV: kv as unknown as KVNamespace,
    SETTINGS_KEY: settingsKey,
    TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
    TELEGRAM_CHAT_ID: '42',
    MAILBOXES: JSON.stringify([
      {
        email: 'user@gmail.com',
        password: TEST_PASSWORD,
        host: 'imap.gmail.com',
        port: 993,
      },
    ]),
    ...overrides,
  };
}

describe('settings encryption', () => {
  it('round-trips settings and rejects a different key', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const wrongKey = crypto.getRandomValues(new Uint8Array(32));
    const payload = await encryptSettings(makeSettings(), key);

    expect(payload).not.toContain(TEST_PASSWORD);
    expect(payload).not.toContain(TEST_BOT_TOKEN);

    const decrypted = await decryptSettings(payload, key);
    expect(decrypted.mailboxes[0]?.password).toBe(TEST_PASSWORD);
    await expect(decryptSettings(payload, wrongKey)).rejects.toThrow(/could not decrypt/);
  });

  it('stores ciphertext in KV and loads it back', async () => {
    const kv = new FakeKV();
    const keyHex = randomKeyHex();
    const env = makeEnv(kv, keyHex);

    expect(settingsKeyConfigured(env)).toBe(true);
    expect(await loadStoredSettings(env)).toBeNull();

    await saveStoredSettings(env, makeSettings({ chatId: '999' }));
    const raw = (await kv.get('settings:v1')) as string;
    expect(raw).not.toContain(TEST_PASSWORD);
    expect(raw).not.toContain(TEST_BOT_TOKEN);

    const loaded = await loadStoredSettings(env);
    expect(loaded?.chatId).toBe('999');
    expect(loaded?.mailboxes[0]?.password).toBe(TEST_PASSWORD);
  });

  it('treats placeholders and short keys as not configured', () => {
    const kv = new FakeKV();
    expect(settingsKeyConfigured(makeEnv(kv, 'replace-with-64-hex-characters'))).toBe(false);
    expect(settingsKeyConfigured(makeEnv(kv, 'short-key'))).toBe(false);
    expect(getSettingsKeyBytes(makeEnv(kv, randomKeyHex()))?.length).toBe(32);
  });
});

describe('settings merge and masking', () => {
  it('keeps existing secrets when empty values are submitted', () => {
    const existing = makeSettings();
    const merged = mergeSubmittedSettings(existing, {
      telegram: { token: '', chatId: '99', junkChatId: '' },
      general: { timeZone: 'UTC' },
      mailboxes: [
        {
          email: 'user@gmail.com',
          password: '',
          host: 'imap.gmail.com',
          port: 993,
        },
      ],
    });

    expect(merged.telegramToken).toBe(TEST_BOT_TOKEN);
    expect(merged.mailboxes[0]?.password).toBe(TEST_PASSWORD);
    expect(merged.chatId).toBe('99');
    expect(merged.timeZone).toBe('UTC');
  });

  it('requires a password for a new mailbox', () => {
    expect(() =>
      mergeSubmittedSettings(makeSettings(), {
        mailboxes: [
          {
            email: 'new@example.com',
            password: '',
            host: 'imap.gmail.com',
            port: 993,
          },
        ],
      }),
    ).toThrow(/requires a password/);
  });

  it('does not expose secrets in the masked view', () => {
    const masked = maskSettings(makeSettings(), 'kv', {
      settingsKeyConfigured: true,
      hasStoredSettings: true,
    });
    expect(masked.telegram.tokenConfigured).toBe(true);
    expect(masked.mailboxes[0]?.passwordConfigured).toBe(true);
    const serialized = JSON.stringify(masked);
    expect(serialized).not.toContain(TEST_PASSWORD);
    expect(serialized).not.toContain(TEST_BOT_TOKEN);
  });

  it('masks and preserves WebDAV credentials', () => {
    const existing = makeSettings({
      verification: {
        enabled: true,
        webdavUrl: 'https://dav.example.org',
        webdavUsername: 'dav-user',
        webdavPassword: TEST_WEBDAV_PASSWORD,
        webdavPath: 'SyncClipboard.json',
      },
    });
    const masked = maskSettings(existing, 'kv', {
      settingsKeyConfigured: true,
      hasStoredSettings: true,
    });
    expect(masked.verification.enabled).toBe(true);
    expect(masked.verification.passwordConfigured).toBe(true);
    expect(JSON.stringify(masked)).not.toContain(TEST_WEBDAV_PASSWORD);

    const merged = mergeSubmittedSettings(existing, {
      verification: {
        webdavUrl: 'https://dav2.example.org',
        webdavPassword: '',
      },
    });
    expect(merged.verification?.webdavUrl).toBe('https://dav2.example.org');
    expect(merged.verification?.webdavPassword).toBe(TEST_WEBDAV_PASSWORD);
  });
});

describe('loadConfig', () => {
  it('uses stored encrypted settings over environment values', async () => {
    const kv = new FakeKV();
    const keyHex = randomKeyHex();
    const env = makeEnv(kv, keyHex);
    await saveStoredSettings(env, makeSettings({ chatId: '999', timeZone: 'UTC' }));

    const loaded = await loadConfig(env);
    expect(loaded.source).toBe('kv');
    expect(loaded.config.chatId).toBe('999');
    expect(loaded.config.timeZone).toBe('UTC');
  });

  it('falls back to environment settings when nothing is stored', async () => {
    const kv = new FakeKV();
    const env = makeEnv(kv, randomKeyHex());
    const loaded = await loadConfig(env);
    expect(loaded.source).toBe('env');
    expect(loaded.config.chatId).toBe('42');
  });
});
