import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerificationSettings } from '../src/env';
import { buildSyncClipboardUrl, pushSyncClipboardText } from '../src/webdav';

const TEST_WEBDAV_USER = ['dav', 'user'].join('-');
const TEST_WEBDAV_PASSWORD = ['dav', 'credential', 'value'].join('-');

function config(overrides: Partial<VerificationSettings> = {}): VerificationSettings {
  return {
    enabled: true,
    webdavUrl: 'https://dav.example.com',
    webdavUsername: TEST_WEBDAV_USER,
    webdavPassword: TEST_WEBDAV_PASSWORD,
    webdavPath: 'SyncClipboard.json',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildSyncClipboardUrl', () => {
  it('joins the base URL and path', () => {
    expect(buildSyncClipboardUrl(config()).toString()).toBe(
      'https://dav.example.com/SyncClipboard.json',
    );
    expect(
      buildSyncClipboardUrl(
        config({ webdavUrl: 'https://dav.example.com/webdav/', webdavPath: '/SyncClipboard.json' }),
      ).toString(),
    ).toBe('https://dav.example.com/webdav/SyncClipboard.json');
  });

  it('rejects private hosts, non-http schemes, and credentials in URLs', () => {
    expect(() => buildSyncClipboardUrl(config({ webdavUrl: 'http://127.0.0.1' }))).toThrow(
      /private or reserved/,
    );
    expect(() => buildSyncClipboardUrl(config({ webdavUrl: 'file:///tmp/x' }))).toThrow(
      /http and https/,
    );
    expect(() =>
      buildSyncClipboardUrl(config({ webdavUrl: 'https://user:pass@dav.example.com' })),
    ).toThrow(/credentials/);
  });
});

describe('pushSyncClipboardText', () => {
  it('writes the Fcitx5/SyncClipboard text profile', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await pushSyncClipboardText(config(), '123456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://dav.example.com/SyncClipboard.json');
    expect(init.method).toBe('PUT');
    expect(init.redirect).toBe('manual');

    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toContain('application/json');
    const expectedAuth = btoa(`${TEST_WEBDAV_USER}:${TEST_WEBDAV_PASSWORD}`);
    expect(headers.get('authorization')).toBe(`Basic ${expectedAuth}`);

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      type: 'Text',
      text: '123456',
      hash: '8D969EEF6ECAD3C29A3A629280E686CF0C3F5D5A86AFF3CA12020C923ADC6C92',
      hasData: false,
      dataName: '',
      size: 6,
    });
  });

  it('omits Authorization when no credentials are configured', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await pushSyncClipboardText(
      config({ webdavUsername: '', webdavPassword: '' }),
      '654321',
    );
    const headers = new Headers((fetchMock.mock.calls[0] as [URL, RequestInit])[1].headers);
    expect(headers.get('authorization')).toBeNull();
  });

  it('rejects redirects and authentication failures', async () => {
    const redirectMock = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'https://example.com' } }),
    );
    vi.stubGlobal('fetch', redirectMock);
    await expect(pushSyncClipboardText(config(), '123456')).rejects.toThrow(/redirect/);

    const authMock = vi.fn(async () => new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', authMock);
    await expect(pushSyncClipboardText(config(), '123456')).rejects.toThrow(
      /authentication failed/,
    );
  });
});
