import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTelegramText } from '../src/telegram';

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, description: string, retryAfter?: number): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      description,
      ...(retryAfter !== undefined ? { parameters: { retry_after: retryAfter } } : {}),
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendTelegramText', () => {
  it('sends HTML to the Telegram Bot API', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await sendTelegramText(
      { token: '123456:ABC', chatId: '42' },
      '42',
      '<b>hello</b>',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://api.telegram.org/bot123456:ABC/sendMessage');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.chat_id).toBe('42');
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toBe('<b>hello</b>');
    expect(init.redirect).toBe('error');
  });

  it('retries after a 429 response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, 'Too Many Requests', 0))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await sendTelegramText({ token: '1:A', chatId: '42' }, '42', 'hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to plain text when Telegram rejects HTML entities', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(400, "Bad Request: can't parse entities"))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await sendTelegramText({ token: '1:A', chatId: '42' }, '42', '<b>a &lt; b</b>');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [URL, RequestInit])[1].body)) as Record<
      string,
      unknown
    >;
    expect(secondBody.parse_mode).toBeUndefined();
    expect(secondBody.text).toBe('a < b');
  });

  it('does not call the API in dry-run mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sendTelegramText({ token: '', chatId: '42', dryRun: true }, '42', 'hello');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('splits long messages into multiple API calls', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await sendTelegramText({ token: '1:A', chatId: '42' }, '42', 'x'.repeat(9000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(String((call as [URL, RequestInit])[1].body)) as Record<string, unknown>;
      expect(String(body.text).length).toBeLessThanOrEqual(4096);
    }
  });

  it('does not retry a non-retryable 400 error', async () => {
    const fetchMock = vi.fn(async () => errorResponse(400, 'Bad Request: chat not found'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendTelegramText({ token: '1:A', chatId: '42' }, '42', 'hello'),
    ).rejects.toThrow(/chat not found/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
