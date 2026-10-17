import { assertSafeHost, assertSafeHttpUrl } from './security';
import { loadStoredSettings } from './settings';
import { isValidTimeZone, parseIntEnv, parseBoolEnv } from './util';

export interface Env {
  MAIL2TG_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_JUNK_CHAT_ID?: string;
  MAILBOXES?: string;
  ADMIN_TOKEN?: string;
  SETTINGS_KEY?: string;
  ENABLE_EVC?: string;
  ENABLE_VERIFICATION_CODE?: string;
  WEBDAV_URL?: string;
  WEBDAV_USERNAME?: string;
  WEBDAV_PASSWORD?: string;
  WEBDAV_PATH?: string;
  LISTEN_MODE?: string;
  IDLE_WINDOW_SECONDS?: string;
  POLL_WINDOW_SECONDS?: string;
  POLL_INTERVAL_SECONDS?: string;
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
export type ListenMode = 'poll' | 'idle';

export interface VerificationSettings {
  enabled: boolean;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavPath: string;
}

export interface Mailbox {
  id: string;
  email: string;
  password: string;
  host: string;
  port: number;
  folders?: string[];
  name?: string;
}

export interface StoredMailbox {
  email: string;
  password: string;
  host: string;
  port: number;
  folders?: string[];
  name?: string;
}

export interface StoredSettings {
  telegramToken: string;
  chatId: string;
  junkChatId: string;
  language: Language;
  timeZone: string;
  maxEmailChars: number;
  maxEmailBytes: number;
  maxMessagesPerRun: number;
  initialSync: InitialSync;
  loginNotify: boolean;
  dedupe: boolean;
  dryRun: boolean;
  listenMode?: ListenMode;
  idleWindowSeconds?: number;
  pollWindowSeconds?: number;
  pollIntervalSeconds?: number;
  mailboxes: StoredMailbox[];
  verification?: VerificationSettings;
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
  listenMode: ListenMode;
  idleWindowSeconds: number;
  pollWindowSeconds: number;
  pollIntervalSeconds: number;
  mailboxes: Mailbox[];
  verification: VerificationSettings;
}

export interface LoadedConfig {
  config: AppConfig;
  source: 'env' | 'kv';
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

function normalizeMailboxRecord(
  raw: Record<string, unknown>,
  fieldPrefix: string,
  index: number,
): Mailbox {
  const email = readString(
    raw.email ?? raw.EMAIL ?? raw.mailbox,
    `${fieldPrefix}[${index}].email`,
  );
  if (!email) {
    throw new Error(`${fieldPrefix}[${index}].email is required`);
  }
  assertSingleLine(email, `${fieldPrefix}[${index}].email`);
  if (!email.includes('@')) {
    throw new Error(`${fieldPrefix}[${index}].email is not a valid email address`);
  }

  const password = readSecretString(
    raw.password ?? raw.PASSWORD,
    `${fieldPrefix}[${index}].password`,
  );
  if (!password) {
    throw new Error(`${fieldPrefix}[${index}].password is required`);
  }
  assertSingleLine(password, `${fieldPrefix}[${index}].password`);

  const rawHost = readString(
    raw.host ?? raw.IMAP_SERVER ?? raw.imapServer ?? raw.server,
    `${fieldPrefix}[${index}].host`,
  );
  if (!rawHost) {
    throw new Error(`${fieldPrefix}[${index}].host is required`);
  }
  const host = assertSafeHost(rawHost);

  const rawPort = raw.port ?? raw.IMAP_SERVER_PORT ?? raw.imapPort ?? 993;
  const port = typeof rawPort === 'number' ? rawPort : Number.parseInt(String(rawPort), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${fieldPrefix}[${index}].port must be an integer between 1 and 65535`);
  }
  if (port === 25) {
    throw new Error('port 25 is blocked by the Workers runtime');
  }

  let folders: string[] | undefined;
  const rawFolders = raw.folders ?? raw.FOLDERS;
  if (rawFolders !== undefined && rawFolders !== null) {
    if (!Array.isArray(rawFolders) || rawFolders.length === 0) {
      throw new Error(`${fieldPrefix}[${index}].folders must be a non-empty array`);
    }
    if (rawFolders.length > 20) {
      throw new Error(`${fieldPrefix}[${index}].folders has too many entries`);
    }
    folders = rawFolders.map((folder, folderIndex) => {
      if (typeof folder !== 'string' || folder.trim() === '') {
        throw new Error(
          `${fieldPrefix}[${index}].folders[${folderIndex}] must be a non-empty string`,
        );
      }
      return assertSingleLine(
        folder.trim(),
        `${fieldPrefix}[${index}].folders[${folderIndex}]`,
      );
    });
    if (new Set(folders.map((folder) => folder.toLowerCase())).size !== folders.length) {
      throw new Error(`${fieldPrefix}[${index}].folders contains duplicates`);
    }
  }

  const name = readString(raw.name ?? raw.NAME, `${fieldPrefix}[${index}].name`);
  if (name) {
    assertSingleLine(name, `${fieldPrefix}[${index}].name`);
    if (name.length > 100) {
      throw new Error(`${fieldPrefix}[${index}].name is too long`);
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

function parseMailboxes(value: string | undefined, fieldPrefix = 'MAILBOXES'): Mailbox[] {
  if (!value || value.trim() === '') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${fieldPrefix} is not valid JSON`);
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length > 50) {
    throw new Error('too many mailboxes configured (max 50)');
  }
  const mailboxes = list.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${fieldPrefix}[${index}] must be an object`);
    }
    return normalizeMailboxRecord(entry as Record<string, unknown>, fieldPrefix, index);
  });
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

function requireNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

export function defaultVerificationSettings(): VerificationSettings {
  return {
    enabled: false,
    webdavUrl: '',
    webdavUsername: '',
    webdavPassword: '',
    webdavPath: 'SyncClipboard.json',
  };
}

function normalizeVerificationSettings(value: unknown): VerificationSettings {
  if (value === undefined || value === null) {
    return defaultVerificationSettings();
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('verification must be an object');
  }
  const record = value as Record<string, unknown>;

  const enabled =
    record.enabled === undefined ? false : requireBoolean(record.enabled, 'verification.enabled');

  const read = (key: string, field: string, fallback: string): string => {
    const raw = record[key];
    if (raw === undefined || raw === null) {
      return fallback;
    }
    if (typeof raw !== 'string') {
      throw new Error(`${field} must be a string`);
    }
    return raw;
  };

  const webdavUrl = read('webdavUrl', 'verification.webdavUrl', '').trim();
  const webdavUsername = read('webdavUsername', 'verification.webdavUsername', '').trim();
  const webdavPassword = read('webdavPassword', 'verification.webdavPassword', '');
  let webdavPath = read('webdavPath', 'verification.webdavPath', 'SyncClipboard.json').trim();

  webdavPath = webdavPath.replace(/^\/+/, '');
  if (webdavPath === '') {
    webdavPath = 'SyncClipboard.json';
  }
  if (`/${webdavPath}/`.includes('/../') || /[?#\u0000-\u001f]/.test(webdavPath)) {
    throw new Error('verification.webdavPath must not contain .., ?, #, or control characters');
  }
  if (webdavUsername.includes(':') || /[\r\n\u0000]/.test(webdavUsername)) {
    throw new Error('verification.webdavUsername must not contain ":" or newlines');
  }
  if (/[\r\n\u0000]/.test(webdavPassword)) {
    throw new Error('verification.webdavPassword must not contain newlines');
  }

  if (enabled && webdavUrl === '') {
    throw new Error('verification.webdavUrl is required when verification is enabled');
  }
  if (enabled) {
    try {
      assertSafeHttpUrl(webdavUrl);
    } catch (error) {
      throw new Error(
        `verification.webdavUrl: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    enabled,
    webdavUrl,
    webdavUsername,
    webdavPassword,
    webdavPath,
  };
}

export function buildConfigFromStoredSettings(
  settings: StoredSettings,
  adminToken: string,
): AppConfig {
  const dryRun = requireBoolean(settings.dryRun, 'DRY_RUN');

  const telegramToken = readToken(settings.telegramToken);
  if (!telegramToken && !dryRun) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }
  const chatId = readChatId(settings.chatId, 'TELEGRAM_CHAT_ID', !dryRun);
  const junkChatId = readChatId(settings.junkChatId, 'TELEGRAM_JUNK_CHAT_ID', false);

  if (adminToken && /\s/.test(adminToken)) {
    throw new Error('ADMIN_TOKEN must not contain whitespace');
  }

  const language =
    settings.language === 'English' || settings.language === 'Chinese'
      ? settings.language
      : (() => {
          throw new Error('LANGUAGE must be "Chinese" or "English"');
        })();

  const timeZone = settings.timeZone?.trim() || 'Asia/Shanghai';
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`invalid TIMEZONE: ${timeZone}`);
  }

  const maxEmailChars = requireNumber(settings.maxEmailChars, 'MAX_EMAIL_CHARS', 100, 20000);
  const maxEmailBytes = requireNumber(
    settings.maxEmailBytes,
    'MAX_EMAIL_BYTES',
    1024,
    25 * 1024 * 1024,
  );
  const maxMessagesPerRun = requireNumber(
    settings.maxMessagesPerRun,
    'MAX_MESSAGES_PER_RUN',
    1,
    200,
  );

  const initialSync =
    settings.initialSync === 'skip' || settings.initialSync === 'latest'
      ? settings.initialSync
      : (() => {
          throw new Error('INITIAL_SYNC must be "skip" or "latest"');
        })();

  const listenMode =
    settings.listenMode === 'idle' || settings.listenMode === 'poll' || settings.listenMode === undefined
      ? (settings.listenMode ?? 'poll')
      : (() => {
          throw new Error('LISTEN_MODE must be "poll" or "idle"');
        })();
  const idleWindowSeconds = requireNumber(
    settings.idleWindowSeconds ?? 40,
    'IDLE_WINDOW_SECONDS',
    10,
    780,
  );
  const pollWindowSeconds = requireNumber(
    settings.pollWindowSeconds ?? 45,
    'POLL_WINDOW_SECONDS',
    10,
    780,
  );
  const pollIntervalSeconds = requireNumber(
    settings.pollIntervalSeconds ?? 20,
    'POLL_INTERVAL_SECONDS',
    5,
    300,
  );

  const mailboxes = settings.mailboxes.map((mailbox, index) => {
    if (typeof mailbox !== 'object' || mailbox === null || Array.isArray(mailbox)) {
      throw new Error(`mailboxes[${index}] must be an object`);
    }
    return normalizeMailboxRecord(
      mailbox as unknown as Record<string, unknown>,
      'mailboxes',
      index,
    );
  });
  if (mailboxes.length > 50) {
    throw new Error('too many mailboxes configured (max 50)');
  }
  const seen = new Set<string>();
  for (const mailbox of mailboxes) {
    if (seen.has(mailbox.id)) {
      throw new Error(`duplicate mailbox email: ${mailbox.email}`);
    }
    seen.add(mailbox.id);
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
    initialSync,
    loginNotify: requireBoolean(settings.loginNotify, 'LOGIN_NOTIFY'),
    dedupe: requireBoolean(settings.dedupe, 'DEDUPE'),
    dryRun,
    listenMode,
    idleWindowSeconds,
    pollWindowSeconds,
    pollIntervalSeconds,
    mailboxes,
    verification: normalizeVerificationSettings(settings.verification),
  };
}

export function defaultStoredSettings(): StoredSettings {
  return {
    telegramToken: '',
    chatId: '',
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
    pollWindowSeconds: 45,
    pollIntervalSeconds: 20,
    mailboxes: [],
    verification: defaultVerificationSettings(),
  };
}

export function storedMailboxFromMailbox(mailbox: Mailbox): StoredMailbox {
  return {
    email: mailbox.email,
    password: mailbox.password,
    host: mailbox.host,
    port: mailbox.port,
    ...(mailbox.folders ? { folders: mailbox.folders } : {}),
    ...(mailbox.name ? { name: mailbox.name } : {}),
  };
}

export function settingsFromEnv(env: Env): StoredSettings {
  const languageRaw = (env.LANGUAGE?.trim() || 'Chinese').toLowerCase();
  const language: Language =
    languageRaw === 'english' || languageRaw === 'en' ? 'English' : 'Chinese';

  const initialSyncRaw = (env.INITIAL_SYNC?.trim() || 'skip').toLowerCase();
  if (initialSyncRaw !== 'skip' && initialSyncRaw !== 'latest') {
    throw new Error('INITIAL_SYNC must be "skip" or "latest"');
  }

  return {
    telegramToken: readToken(env.TELEGRAM_BOT_TOKEN) ?? '',
    chatId: env.TELEGRAM_CHAT_ID?.trim() ?? '',
    junkChatId: env.TELEGRAM_JUNK_CHAT_ID?.trim() ?? '',
    language,
    timeZone: env.TIMEZONE?.trim() || 'Asia/Shanghai',
    maxEmailChars: parseIntEnv(env.MAX_EMAIL_CHARS, 3000),
    maxEmailBytes: parseIntEnv(env.MAX_EMAIL_BYTES, 10 * 1024 * 1024),
    maxMessagesPerRun: parseIntEnv(env.MAX_MESSAGES_PER_RUN, 20),
    initialSync: initialSyncRaw,
    loginNotify: parseBoolEnv(env.LOGIN_NOTIFY, true),
    dedupe: parseBoolEnv(env.DEDUPE, true),
    dryRun: parseBoolEnv(env.DRY_RUN, false),
    listenMode: (env.LISTEN_MODE?.trim().toLowerCase() === 'idle' ? 'idle' : 'poll') as ListenMode,
    idleWindowSeconds: parseIntEnv(env.IDLE_WINDOW_SECONDS, 40),
    pollWindowSeconds: parseIntEnv(env.POLL_WINDOW_SECONDS, 45),
    pollIntervalSeconds: parseIntEnv(env.POLL_INTERVAL_SECONDS, 20),
    mailboxes: parseMailboxes(env.MAILBOXES).map(storedMailboxFromMailbox),
    verification: {
      enabled: parseBoolEnv(env.ENABLE_EVC ?? env.ENABLE_VERIFICATION_CODE, false),
      webdavUrl: env.WEBDAV_URL?.trim() ?? '',
      webdavUsername: env.WEBDAV_USERNAME?.trim() ?? '',
      webdavPassword: env.WEBDAV_PASSWORD ?? '',
      webdavPath: env.WEBDAV_PATH?.trim() || 'SyncClipboard.json',
    },
  };
}

export function parseConfig(env: Env): AppConfig {
  return buildConfigFromStoredSettings(
    settingsFromEnv(env),
    env.ADMIN_TOKEN?.trim() ?? '',
  );
}

export async function loadConfig(env: Env): Promise<LoadedConfig> {
  if (env.SETTINGS_KEY) {
    const stored = await loadStoredSettings(env);
    if (stored) {
      return {
        config: buildConfigFromStoredSettings(stored, env.ADMIN_TOKEN?.trim() ?? ''),
        source: 'kv',
      };
    }
  }
  return { config: parseConfig(env), source: 'env' };
}

/** Config problems for health checks, without leaking secret values. */
export function describeConfigError(env: Env): string | null {
  try {
    parseConfig(env);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
