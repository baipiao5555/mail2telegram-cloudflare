import { assertTelegramApiUrl } from './security';
import { chunkText, sleep, telegramHtmlToPlain } from './util';

export interface TelegramSenderOptions {
  token: string;
  chatId: string;
  dryRun?: boolean;
  maxAttempts?: number;
  timeoutMs?: number;
}

interface ApiResult {
  ok: boolean;
  status: number;
  description: string;
  retryAfter?: number;
}

const TELEGRAM_LIMIT = 4096;
const CHUNK_LIMIT = 3800;

function isEntityError(description: string): boolean {
  return /can't parse entities|can't find end tag|unsupported start tag|unexpected end tag/i.test(
    description,
  );
}

function sanitize(message: string, token: string): string {
  return token ? message.split(token).join('[token]') : message;
}

class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

async function callSendMessage(
  options: TelegramSenderOptions,
  chatId: string,
  text: string,
  parseMode: 'HTML' | undefined,
): Promise<ApiResult> {
  const url = new URL(`https://api.telegram.org/bot${options.token}/sendMessage`);
  assertTelegramApiUrl(url);

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    link_preview_options: { is_disabled: true },
  };
  if (parseMode) {
    body.parse_mode = parseMode;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });

  const raw = await response.text();
  let payload: {
    ok?: boolean;
    description?: string;
    parameters?: { retry_after?: number };
  } = {};
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    // Telegram always returns JSON; a proxy may not.
  }

  const status = response.status;
  return {
    ok: response.ok && payload.ok === true,
    status,
    description: payload.description ?? (raw.slice(0, 300) || `HTTP ${status}`),
    ...(typeof payload.parameters?.retry_after === 'number'
      ? { retryAfter: payload.parameters.retry_after }
      : {}),
  };
}

async function sendOne(
  options: TelegramSenderOptions,
  chatId: string,
  html: string,
  parseMode: 'HTML' | undefined,
): Promise<void> {
  const attempts = options.maxAttempts ?? 3;
  let mode = parseMode;
  let text = html;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await callSendMessage(options, chatId, text, mode);
      if (result.ok) {
        return;
      }

      if (mode === 'HTML' && result.status === 400 && isEntityError(result.description)) {
        mode = undefined;
        text = telegramHtmlToPlain(text);
        continue;
      }

      if ((result.status === 429 || result.status >= 500) && attempt < attempts) {
        const retryAfter = Math.min(result.retryAfter ?? attempt * 2, 10);
        await sleep(retryAfter * 1000);
        continue;
      }

      throw new TelegramApiError(
        `Telegram API error (${result.status}): ${result.description}`,
        result.status === 429 || result.status >= 500,
      );
    } catch (error) {
      if (error instanceof TelegramApiError && !error.retryable) {
        throw error;
      }
      if (attempt >= attempts) {
        throw error;
      }
      await sleep(attempt * 1000);
    }
  }
}

/** Sends a possibly long message, splitting it into Telegram-sized chunks. */
export async function sendTelegramText(
  options: TelegramSenderOptions,
  chatId: string,
  html: string,
): Promise<void> {
  if (!html.trim()) {
    return;
  }
  if (options.dryRun) {
    console.log(`[dry-run] would send ${html.length} chars to Telegram chat ${chatId}`);
    return;
  }
  if (!options.token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }

  const chunks = chunkText(html, CHUNK_LIMIT);
  for (let index = 0; index < chunks.length; index++) {
    const prefix = chunks.length > 1 ? `[${index + 1}/${chunks.length}]\n` : '';
    const text = `${prefix}${chunks[index]!}`;
    if (text.length > TELEGRAM_LIMIT) {
      throw new Error('internal error: Telegram chunk exceeds the API limit');
    }
    await sendOne(options, chatId, text, 'HTML');
  }
}

export function makeSenderOptions(
  token: string,
  chatId: string,
  dryRun: boolean,
): TelegramSenderOptions {
  return { token, chatId, dryRun };
}

export async function sendTestMessage(options: TelegramSenderOptions, chatId: string): Promise<void> {
  await sendTelegramText(
    options,
    chatId,
    '<b>Mail2Telegram Cloudflare Worker</b>\n测试消息 / test message',
  );
}

export function telegramErrorForLog(error: unknown, token: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitize(message, token);
}
