const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  minus: '−',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  times: '×',
  divide: '÷',
  deg: '°',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  prime: '′',
  Prime: '″',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  hearts: '♥',
  star: '★',
  check: '✓',
  cross: '✗',
  zwj: '',
  zwnj: '',
  lrm: '',
  rlm: '',
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const codePoint =
        entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
        return match;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return HTML_ENTITIES[entity] ?? HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const REMOVED_BLOCK =
  /<(script|style|head|title|noscript|iframe|svg|object|video|audio|canvas|template)[^>]*>[\s\S]*?<\/\1\s*>/gi;

export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[if[\s\S]*?<!\[endif\]>/gi, '')
    .replace(REMOVED_BLOCK, '');

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table|section|article|header|footer|form|ul|ol|dl|dt|dd)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ');

  text = decodeHtmlEntities(text);

  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v\u00a0\u200b]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Turn the Telegram HTML emitted by this Worker back into plain text for the fallback send. */
export function telegramHtmlToPlain(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ''));
}

export function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

/** Split text into Telegram-safe chunks, preferring line breaks and never splitting a surrogate pair. */
export function chunkText(text: string, limit = 3800): string[] {
  if (limit < 2) {
    throw new Error('chunk limit is too small');
  }
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.5)) {
      cut = limit;
    }
    if (cut > 0) {
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) {
        cut -= 1;
      }
    }
    if (cut <= 0) {
      cut = limit;
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length > 0) {
    chunks.push(rest);
  }
  return chunks;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function formatDateTime(value: string | undefined, timeZone: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return value ?? '';
  }

  const formatters: Intl.DateTimeFormat[] = [];
  for (const zone of [timeZone, 'UTC']) {
    try {
      formatters.push(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: zone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      );
      break;
    } catch {
      // Try the next zone.
    }
  }
  if (formatters.length === 0) {
    return date.toISOString();
  }

  const parts = formatters[0]!.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64UrlEncode(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`invalid integer value: ${value}`);
  }
  return parsed;
}

export function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      throw new Error(`invalid boolean value: ${value}`);
  }
}
