import PostalMime, { decodeWords } from 'postal-mime';
import type { Address, Header, Mailbox } from 'postal-mime';
import { htmlToText } from './util';

const MAX_HTML_INPUT_CHARS = 1_000_000;
const MAX_PLAIN_INPUT_CHARS = 1_000_000;

export interface ParsedMail {
  subject: string;
  from: string;
  date?: string;
  messageId?: string;
  deliveredTo?: string;
  xOriginalTo?: string;
  toHeader?: string;
  content: string;
  attachments: number;
}

export interface HeaderPreview {
  subject: string;
  from: string;
  date?: string;
  messageId?: string;
  deliveredTo?: string;
  xOriginalTo?: string;
  toHeader?: string;
}

function mailboxText(mailbox: Mailbox): string {
  if (mailbox.name && mailbox.address) {
    return `${mailbox.name} <${mailbox.address}>`;
  }
  return mailbox.address || mailbox.name || '';
}

function addressText(address: Address | undefined): string {
  if (!address) {
    return '';
  }
  if (address.group) {
    return `${address.name}: ${address.group.map(mailboxText).join(', ')};`;
  }
  return mailboxText(address);
}

function headerValue(headers: Header[], key: string): string | undefined {
  const found = headers.find((header) => header.key.toLowerCase() === key.toLowerCase());
  const value = found?.value.trim();
  return value ? value : undefined;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v\u00a0\u200b]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildContent(html: string | undefined, plain: string | undefined): string {
  if (html) {
    const text = htmlToText(html.slice(0, MAX_HTML_INPUT_CHARS));
    const normalized = normalizeText(text);
    if (normalized) {
      return normalized;
    }
  }
  if (plain) {
    return normalizeText(plain.slice(0, MAX_PLAIN_INPUT_CHARS));
  }
  return '';
}

function normalizeMessageId(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^</, '').replace(/>$/, '').trim();
  return normalized ? normalized : undefined;
}

function toParsedMail(email: Awaited<ReturnType<typeof PostalMime.parse>>): ParsedMail {
  const headers = email.headers ?? [];
  return {
    subject: email.subject?.trim() ?? '',
    from: addressText(email.from) || headerValue(headers, 'from') || '',
    date: email.date,
    messageId: normalizeMessageId(email.messageId),
    deliveredTo: email.deliveredTo?.trim() || undefined,
    xOriginalTo: headerValue(headers, 'x-original-to'),
    toHeader: headerValue(headers, 'to') || (email.to ?? []).map(addressText).join(', '),
    content: buildContent(email.html, email.text),
    attachments: email.attachments?.length ?? 0,
  };
}

export async function parseRawEmail(raw: Uint8Array): Promise<ParsedMail> {
  try {
    const parsed = toParsedMail(await PostalMime.parse(raw));
    if (!parsed.subject && !parsed.from && !parsed.content) {
      return fallbackParse(raw);
    }
    return parsed;
  } catch {
    return fallbackParse(raw);
  }
}

/** Parses only the header block fetched for oversized messages. */
export async function parseHeaderBlock(raw: Uint8Array): Promise<HeaderPreview> {
  try {
    const email = await PostalMime.parse(raw);
    return {
      subject: email.subject?.trim() ?? '',
      from: addressText(email.from) || headerValue(email.headers ?? [], 'from') || '',
      date: email.date,
      messageId: normalizeMessageId(email.messageId),
      deliveredTo: email.deliveredTo?.trim() || undefined,
      xOriginalTo: headerValue(email.headers ?? [], 'x-original-to'),
      toHeader: headerValue(email.headers ?? [], 'to') || (email.to ?? []).map(addressText).join(', '),
    };
  } catch {
    const fallback = fallbackParse(raw);
    return {
      subject: fallback.subject,
      from: fallback.from,
      date: fallback.date,
      messageId: fallback.messageId,
      deliveredTo: fallback.deliveredTo,
      xOriginalTo: fallback.xOriginalTo,
      toHeader: fallback.toHeader,
    };
  }
}

/** Best-effort extraction so a malformed message still produces a notification and advances the cursor. */
function fallbackParse(raw: Uint8Array): ParsedMail {
  const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(raw.subarray(0, 64 * 1024));
  const headerBlock = text.split(/\r?\n\r?\n/, 1)[0] ?? '';

  const headers = new Map<string, string>();
  let currentKey = '';
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && currentKey) {
      headers.set(currentKey, `${headers.get(currentKey) ?? ''} ${line.trim()}`);
      continue;
    }
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    currentKey = line.slice(0, separator).trim().toLowerCase();
    headers.set(currentKey, line.slice(separator + 1).trim());
  }

  let subject = headers.get('subject') ?? '';
  let from = headers.get('from') ?? '';
  try {
    subject = decodeWords(subject);
    from = decodeWords(from);
  } catch {
    // Keep the raw header values.
  }

  const messageId = headers.get('message-id')?.replace(/^<|>$/g, '').trim();

  return {
    subject,
    from,
    date: headers.get('date'),
    messageId: messageId || undefined,
    deliveredTo: headers.get('delivered-to'),
    xOriginalTo: headers.get('x-original-to'),
    toHeader: headers.get('to'),
    content: '(邮件解析失败，请到邮箱查看 / failed to parse this message)',
    attachments: 0,
  };
}

export interface ForwardInfo {
  shownAccount: string;
  from: string;
}

/**
 * Mirrors the original project's forwarded-mail detection: when the first delivery
 * recipient header does not contain the monitored address, show that original recipient.
 */
export function detectForwarding(mail: ParsedMail, accountEmail: string): ForwardInfo {
  const primary = mail.deliveredTo ?? mail.xOriginalTo ?? mail.toHeader;
  if (primary && !primary.toLowerCase().includes(accountEmail.toLowerCase())) {
    return { shownAccount: primary, from: mail.from };
  }
  return { shownAccount: accountEmail, from: mail.from };
}
