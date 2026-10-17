import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';
import { FakeKV } from './helpers/fake-kv';

const ctx = {} as ExecutionContext;
const TEST_MAILBOX_PASSWORD = ['app', 'credential', 'value'].join('-');

function randomKeyHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function settingsPayload() {
  return {
    telegram: { token: '', chatId: '42', junkChatId: '' },
    general: {
      language: 'Chinese',
      timeZone: 'UTC',
      maxEmailChars: 3000,
      maxEmailBytes: 10 * 1024 * 1024,
      maxMessagesPerRun: 20,
      initialSync: 'skip',
      loginNotify: true,
      dedupe: true,
      dryRun: false,
      listenMode: 'poll',
      idleWindowSeconds: 40,
      pollWindowSeconds: 45,
      pollIntervalSeconds: 20,
    },
    mailboxes: [
      {
        email: 'user@gmail.com',
        password: TEST_MAILBOX_PASSWORD,
        host: 'imap.gmail.com',
        port: 993,
      },
    ],
    verification: {
      enabled: false,
      webdavUrl: '',
      webdavUsername: '',
      webdavPassword: '',
      webdavPath: 'SyncClipboard.json',
    },
  };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    MAIL2TG_KV: new FakeKV() as unknown as KVNamespace,
    TELEGRAM_BOT_TOKEN: '123456:ABC',
    TELEGRAM_CHAT_ID: '42',
    MAILBOXES: JSON.stringify([
      { email: 'user@gmail.com', password: 'app-password', host: 'imap.gmail.com' },
    ]),
    ADMIN_TOKEN: 'admin-secret-token',
    ...overrides,
  };
}

function request(path: string, init: RequestInit = {}, token?: string): Request {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return new Request(`https://worker.example.com${path}`, { ...init, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP endpoints', () => {
  it('serves the dashboard UI with security headers and no secrets', async () => {
    const response = await worker.fetch(request('/'), env(), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');

    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).toContain("style-src 'nonce-");
    expect(csp).toContain("frame-ancestors 'none'");

    const html = await response.text();
    expect(html).toContain('Mail2Telegram');
    expect(html).toContain('id="loginPanel"');
    expect(html).toContain('ADMIN_TOKEN');
    expect(html).not.toContain('user@gmail.com');
    expect(html).not.toContain('app-password');
    expect(html).not.toContain('123456:ABC');
  });

  it('serves the dashboard at /dashboard and rejects other methods', async () => {
    const dashboard = await worker.fetch(request('/dashboard'), env(), ctx);
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).toContain('id="dashboard"');

    const head = await worker.fetch(request('/', { method: 'HEAD' }), env(), ctx);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const post = await worker.fetch(request('/', { method: 'POST' }), env(), ctx);
    expect(post.status).toBe(405);
  });

  it('serves public health information without secrets', async () => {
    const response = await worker.fetch(request('/health'), env(), ctx);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(true);
    expect(body.mailboxes).toBe(1);
    expect(JSON.stringify(body)).not.toContain('app-password');
    expect(JSON.stringify(body)).not.toContain('123456:ABC');
  });

  it('requires ADMIN_TOKEN for status and run', async () => {
    const noToken = await worker.fetch(request('/status'), env({ ADMIN_TOKEN: '' }), ctx);
    expect(noToken.status).toBe(503);

    const unauthorized = await worker.fetch(request('/status'), env(), ctx);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('www-authenticate')).toBe('Bearer');

    const authorized = await worker.fetch(
      request('/status', {}, 'admin-secret-token'),
      env(),
      ctx,
    );
    expect(authorized.status).toBe(200);
    const body = (await authorized.json()) as { mailboxes: { email: string }[] };
    expect(body.mailboxes[0]?.email).toBe('user@gmail.com');
  });

  it('returns method not allowed for wrong methods', async () => {
    const response = await worker.fetch(request('/run', {}, 'admin-secret-token'), env(), ctx);
    expect(response.status).toBe(405);

    const run = await worker.fetch(
      request('/run', { method: 'POST' }, 'admin-secret-token'),
      env({ DRY_RUN: 'true', MAILBOXES: '[]' }),
      ctx,
    );
    expect(run.status).toBe(400);
  });

  it('sends a dry-run test message without calling Telegram', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      request('/telegram/test', { method: 'POST' }, 'admin-secret-token'),
      env({ DRY_RUN: 'true' }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, dryRun: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not expose configuration errors through the public health endpoint', async () => {
    const response = await worker.fetch(
      request('/health'),
      env({ TELEGRAM_BOT_TOKEN: '' }),
      ctx,
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain('TELEGRAM_BOT_TOKEN');
    expect(JSON.parse(raw).configured).toBe(false);
  });

  it('returns masked settings and protects the endpoint', async () => {
    const settingsEnv = env({ SETTINGS_KEY: randomKeyHex() });

    const unauthorized = await worker.fetch(request('/api/settings'), settingsEnv, ctx);
    expect(unauthorized.status).toBe(401);

    const response = await worker.fetch(
      request('/api/settings', {}, 'admin-secret-token'),
      settingsEnv,
      ctx,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      source: string;
      settingsKeyConfigured: boolean;
      telegram: { tokenConfigured: boolean };
      mailboxes: { email: string; passwordConfigured: boolean }[];
    };
    expect(body.source).toBe('env');
    expect(body.settingsKeyConfigured).toBe(true);
    expect(body.telegram.tokenConfigured).toBe(true);
    expect(body.mailboxes[0]?.email).toBe('user@gmail.com');
    expect(body.mailboxes[0]?.passwordConfigured).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('app-password');
    expect(serialized).not.toContain('123456:ABC');
  });

  it('saves encrypted settings and uses them for status', async () => {
    const kv = new FakeKV();
    const settingsEnv = env({
      MAIL2TG_KV: kv as unknown as KVNamespace,
      SETTINGS_KEY: randomKeyHex(),
    });

    const save = await worker.fetch(
      request(
        '/api/settings',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(settingsPayload()),
        },
        'admin-secret-token',
      ),
      settingsEnv,
      ctx,
    );
    expect(save.status).toBe(200);

    const raw = (await kv.get('settings:v1')) as string;
    expect(raw).not.toContain(TEST_MAILBOX_PASSWORD);
    expect(raw).not.toContain('123456:ABC');

    const settingsResponse = await worker.fetch(
      request('/api/settings', {}, 'admin-secret-token'),
      settingsEnv,
      ctx,
    );
    const settingsBody = (await settingsResponse.json()) as {
      source: string;
      telegram: { tokenConfigured: boolean };
      mailboxes: { passwordConfigured: boolean }[];
    };
    expect(settingsBody.source).toBe('kv');
    expect(settingsBody.telegram.tokenConfigured).toBe(true);
    expect(settingsBody.mailboxes[0]?.passwordConfigured).toBe(true);

    const status = await worker.fetch(
      request('/status', {}, 'admin-secret-token'),
      settingsEnv,
      ctx,
    );
    const statusBody = (await status.json()) as { timeZone: string; configSource: string };
    expect(statusBody.timeZone).toBe('UTC');
    expect(statusBody.configSource).toBe('kv');

    const replaceWithoutSecrets = await worker.fetch(
      request(
        '/api/settings',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            telegram: { token: '', chatId: '42', junkChatId: '' },
            mailboxes: [
              {
                email: 'user@gmail.com',
                password: '',
                host: 'imap.gmail.com',
                port: 993,
              },
            ],
          }),
        },
        'admin-secret-token',
      ),
      settingsEnv,
      ctx,
    );
    expect(replaceWithoutSecrets.status).toBe(200);

    const stillConfigured = await worker.fetch(
      request('/api/settings', {}, 'admin-secret-token'),
      settingsEnv,
      ctx,
    );
    const stillBody = (await stillConfigured.json()) as {
      telegram: { tokenConfigured: boolean };
      mailboxes: { passwordConfigured: boolean }[];
    };
    expect(stillBody.telegram.tokenConfigured).toBe(true);
    expect(stillBody.mailboxes[0]?.passwordConfigured).toBe(true);
  });

  it('can reset stored settings back to environment values', async () => {
    const kv = new FakeKV();
    const settingsEnv = env({
      MAIL2TG_KV: kv as unknown as KVNamespace,
      SETTINGS_KEY: randomKeyHex(),
    });

    await worker.fetch(
      request(
        '/api/settings',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(settingsPayload()),
        },
        'admin-secret-token',
      ),
      settingsEnv,
      ctx,
    );

    const reset = await worker.fetch(
      request('/api/settings', { method: 'DELETE' }, 'admin-secret-token'),
      settingsEnv,
      ctx,
    );
    expect(reset.status).toBe(200);

    const response = await worker.fetch(
      request('/api/settings', {}, 'admin-secret-token'),
      settingsEnv,
      ctx,
    );
    const body = (await response.json()) as { source: string };
    expect(body.source).toBe('env');
  });

  it('rejects settings saves without SETTINGS_KEY and invalid settings', async () => {
    const noKey = await worker.fetch(
      request(
        '/api/settings',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(settingsPayload()),
        },
        'admin-secret-token',
      ),
      env(),
      ctx,
    );
    expect(noKey.status).toBe(503);

    const keyed = env({ SETTINGS_KEY: randomKeyHex() });
    const invalid = await worker.fetch(
      request(
        '/api/settings',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mailboxes: [
              {
                email: 'user@gmail.com',
                password: TEST_MAILBOX_PASSWORD,
                host: '127.0.0.1',
                port: 993,
              },
            ],
          }),
        },
        'admin-secret-token',
      ),
      keyed,
      ctx,
    );
    expect(invalid.status).toBe(400);
    const body = (await invalid.json()) as { error: string };
    expect(body.error).toMatch(/private or reserved/);
  });
});
