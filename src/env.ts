import { assertSafeHost } from './security';
import {
  isValidTimeZone,
  parseIntEnv,
  parseBoolEnv,
  errorMessage,
} from './util';

export interface Env {
  MAIL2TG_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_JUNK_CHAT_ID?: string;
  MAILBOXES?: string;
  ADMIN_TOKEN?: string;
  LANGUAGE?: string;
  TIMEZONE?: string;
  MAX_EMAIL_CHARS?: string;
  MAX_EMAIL_BYTES?: string;
  MAX_MESSAGES_PER_RUN?: string;
  INITIAL_SYNC?: string;
  LOGIN_NOTIFY?: string;
  DEDUPE?: string;
  DRY_RUN?: string;
}

export type Language = 'Chinese' | 'English';
export type InitialSync = 'skip' | 'latest';

export interface Mailbox {
  id: string;
  email: string;
  password: string;
  host: string;
  port: number;
  folders?: string[];
  name?: string;
}

export interface AppConfig {
  telegramToken: string;
  chatId: string;
  junkChatId: string;
  adminToken: string;
  language: Language;
  timeZone: string;
  maxEmailChars: number;
  maxEmailBytes: number;
  maxMessagesPerRun: number;
  initialSync: InitialSync;
  loginNotify: boolean;
  dedupe: boolean;
  dryRun: boolean;
  mailboxes: Mailbox[];
}

function readString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Preserves leading/trailing spaces in credentials, but treats whitespace-only values as missing. */
function readSecretString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return value.trim() === '' ? undefined : value;
}

function assertSingleLine(value: string, field: string): string {
  if (/[\r\n\u0000]/.test(value)) {
    throw new Error(`${field} must not contain newlines or NUL characters`);
  }
  return value;
}

function normalizeMailbox(raw: unknown, index: number): Mailbox {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`MAILBOXES[${index}] must be an object`);
  }
  const record = raw as Record<string, unknown>;

  const email = readString(record.email ?? record.EMAIL ?? record.mailbox, `MAILBOXES[${index}].email`);
  if (!email) {
    throw new Error(`MAILBOXES[${index}].email is required`);
  }
  assertSingleLine(email, `MAILBOXES[${index}].email`);
  if (!email.includes('@')) {
    throw new Error(`MAILBOXES[${index}].email is not a valid email address`);
  }

  const password = readSecretString(record.password ?? record.PASSWORD, `MAILBOXES[${index}].password`);
  if (!password) {
    throw new Error(`MAILBOXES[${index}].password is required`);
  }
  assertSingleLine(password, `MAILBOXES[${index}].password`);

  const rawHost = readString(
    record.host ?? record.IMAP_SERVER ?? record.imapServer ?? record.server,
    `MAILBOXES[${index}].host`,
  );
  if (!rawHost) {
    throw new Error(`MAILBOXES[${index}].host is required`);
  }
  const host = assertSafeHost(rawHost);

  const rawPort = record.port ?? record.IMAP_SERVER_PORT ?? record.imapPort ?? 993;
  const port = typeof rawPort === 'number' ? rawPort : Number.parseInt(String(rawPort), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`MAILBOXES[${index}].port must be an integer between 1 and 65535`);
  }
  if (port === 25) {
    throw new Error('port 25 is blocked by the Workers runtime');
  }

  let folders: string[] | undefined;
  const rawFolders = record.folders ?? record.FOLDERS;
  if (rawFolders !== undefined) {
    if (!Array.isArray(rawFolders) || rawFolders.length === 0) {
      throw new Error(`MAILBOXES[${index}].folders must be a non-empty array`);
    }
    if (rawFolders.length > 20) {
      throw new Error(`MAILBOXES[${index}].folders has too many entries`);
    }
    folders = rawFolders.map((folder, folderIndex) => {
      if (typeof folder !== 'string' || folder.trim() === '') {
        throw new Error(`MAILBOXES[${index}].folders[${folderIndex}] must be a non-empty string`);
      }
      return assertSingleLine(folder.trim(), `MAILBOXES[${index}].folders[${folderIndex}]`);
    });
    if (new Set(folders.map((folder) => folder.toLowerCase())).size !== folders.length) {
      throw new Error(`MAILBOXES[${index}].folders contains duplicates`);
    }
  }

  const name = readString(record.name ?? record.NAME, `MAILBOXES[${index}].name`);
  if (name) {
    assertSingleLine(name, `MAILBOXES[${index}].name`);
    if (name.length > 100) {
      throw new Error(`MAILBOXES[${index}].name is too long`);
    }
  }

  return {
    id: email.toLowerCase(),
    email,
    password,
    host,
    port,
    ...(folders ? { folders } : {}),
    ...(name ? { name } : {}),
  };
}

function parseMailboxes(value: string | undefined): Mailbox[] {
  if (!value || value.trim() === '') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('MAILBOXES is not valid JSON');
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length > 50) {
    throw new Error('too many mailboxes configured (max 50)');
  }
  const mailboxes = list.map((entry, index) => normalizeMailbox(entry, index));
  const seen = new Set<string>();
  for (const mailbox of mailboxes) {
    if (seen.has(mailbox.id)) {
      throw new Error(`duplicate mailbox email: ${mailbox.email}`);
    }
    seen.add(mailbox.id);
  }
  return mailboxes;
}

function readChatId(value: string | undefined, field: string, required: boolean): string {
  const chatId = value?.trim() ?? '';
  if (chatId === '') {
    if (required) {
      throw new Error(`${field} is required`);
    }
    return '';
  }
  if (/\s/.test(chatId) || /[\r\n\u0000]/.test(chatId)) {
    throw new Error(`${field} must not contain whitespace`);
  }
  return chatId;
}

function readToken(value: string | undefined): string {
  const token = value?.trim() ?? '';
  if (token === '') {
    return '';
  }
  if (!/^[A-Za-z0-9:_-]+$/.test(token)) {
    throw new Error('TELEGRAM_BOT_TOKEN has an unexpected format');
  }
  return token;
}

export function parseConfig(env: Env): AppConfig {
  const dryRun = parseBoolEnv(env.DRY_RUN, false);

  const languageRaw = (env.LANGUAGE?.trim() || 'Chinese').toLowerCase();
  const language: Language =
    languageRaw === 'english' || languageRaw === 'en' ? 'English' : 'Chinese';

  const timeZone = env.TIMEZONE?.trim() || 'Asia/Shanghai';
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`invalid TIMEZONE: ${timeZone}`);
  }

  const telegramToken = readToken(env.TELEGRAM_BOT_TOKEN);
  if (!telegramToken && !dryRun) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }
  const chatId = readChatId(env.TELEGRAM_CHAT_ID, 'TELEGRAM_CHAT_ID', !dryRun);
  const junkChatId = readChatId(env.TELEGRAM_JUNK_CHAT_ID, 'TELEGRAM_JUNK_CHAT_ID', false);

  const adminToken = env.ADMIN_TOKEN?.trim() ?? '';
  if (adminToken && /\s/.test(adminToken)) {
    throw new Error('ADMIN_TOKEN must not contain whitespace');
  }

  const maxEmailChars = parseIntEnv(env.MAX_EMAIL_CHARS, 3000);
  if (maxEmailChars < 100 || maxEmailChars > 20000) {
    throw new Error('MAX_EMAIL_CHARS must be between 100 and 20000');
  }

  const maxEmailBytes = parseIntEnv(env.MAX_EMAIL_BYTES, 10 * 1024 * 1024);
  if (maxEmailBytes < 1024 || maxEmailBytes > 25 * 1024 * 1024) {
    throw new Error('MAX_EMAIL_BYTES must be between 1024 and 26214400');
  }

  const maxMessagesPerRun = parseIntEnv(env.MAX_MESSAGES_PER_RUN, 20);
  if (maxMessagesPerRun < 1 || maxMessagesPerRun > 200) {
    throw new Error('MAX_MESSAGES_PER_RUN must be between 1 and 200');
  }

  const initialSyncRaw = (env.INITIAL_SYNC?.trim() || 'skip').toLowerCase();
  if (initialSyncRaw !== 'skip' && initialSyncRaw !== 'latest') {
    throw new Error('INITIAL_SYNC must be "skip" or "latest"');
  }

  return {
    telegramToken,
    chatId,
    junkChatId,
    adminToken,
    language,
    timeZone,
    maxEmailChars,
    maxEmailBytes,
    maxMessagesPerRun,
    initialSync: initialSyncRaw,
    loginNotify: parseBoolEnv(env.LOGIN_NOTIFY, true),
    dedupe: parseBoolEnv(env.DEDUPE, true),
    dryRun,
    mailboxes: parseMailboxes(env.MAILBOXES),
  };
}

/** Config problems for /health, without leaking secret values. */
export function describeConfigError(env: Env): string | null {
  try {
    parseConfig(env);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}
