import type { VerificationSettings } from './env';
import { assertSafeHttpUrl } from './security';
import { bytesToBase64, sha256Hex } from './util';

const DEFAULT_WEBDAV_PATH = 'SyncClipboard.json';

export function buildSyncClipboardUrl(settings: VerificationSettings): URL {
  const endpoint = assertSafeHttpUrl(settings.webdavUrl);
  const path = (settings.webdavPath || DEFAULT_WEBDAV_PATH).replace(/^\/+/, '');
  if (
    path === '' ||
    `/${path}/`.includes('/../') ||
    /[?#\u0000-\u001f]/.test(path)
  ) {
    throw new Error('invalid WebDAV path');
  }

  const basePath = endpoint.pathname.replace(/\/+$/, '');
  endpoint.pathname = `${basePath}/${path}`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
}

/**
 * Writes a text profile that SyncClipboard and Fcitx5-SyncClipboard can read
 * from a WebDAV server. The SHA-256 hash is uppercase, matching the client.
 */
export async function pushSyncClipboardText(
  settings: VerificationSettings,
  text: string,
): Promise<void> {
  const endpoint = buildSyncClipboardUrl(settings);
  const hash = (await sha256Hex(text)).toUpperCase();
  const payload = JSON.stringify({
    type: 'Text',
    text,
    hash,
    hasData: false,
    dataName: '',
    size: new TextEncoder().encode(text).length,
  });

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
  };
  if (settings.webdavUsername !== '' || settings.webdavPassword !== '') {
    headers.Authorization = `Basic ${bytesToBase64(
      new TextEncoder().encode(`${settings.webdavUsername}:${settings.webdavPassword}`),
    )}`;
  }

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers,
    body: payload,
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });

  const responseType = String((response as unknown as { type?: unknown }).type ?? '');
  if (responseType === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new Error('WebDAV returned an unexpected redirect');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('WebDAV authentication failed');
    }
    throw new Error(`WebDAV PUT failed: HTTP ${response.status}`);
  }
}
