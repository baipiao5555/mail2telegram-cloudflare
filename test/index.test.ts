import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';
import { FakeKV } from './helpers/fake-kv';

const ctx = {} as ExecutionContext;

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
});
