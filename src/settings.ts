import type { Env, StoredMailbox, StoredSettings, VerificationSettings } from './env';
import { base64ToBytes, bytesToBase64 } from './util';

const KV_KEY = 'settings:v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const EMPTY_VERIFICATION: VerificationSettings = {
  enabled: false,
  webdavUrl: '',
  webdavUsername: '',
  webdavPassword: '',
  webdavPath: 'SyncClipboard.json',
};

export interface MaskedMailbox {
  email: string;
  host: string;
  port: number;
  folders?: string[];
  name?: string;
  passwordConfigured: boolean;
}

export interface MaskedSettings {
  source: 'kv' | 'env' | 'none';
  settingsKeyConfigured: boolean;
  hasStoredSettings: boolean;
  telegram: {
    tokenConfigured: boolean;
    chatId: string;
    junkChatId: string;
  };
  mailboxes: MaskedMailbox[];
  general: {
    language: string;
    timeZone: string;
    maxEmailChars: number;
    maxEmailBytes: number;
    maxMessagesPerRun: number;
    initialSync: string;
    loginNotify: boolean;
    dedupe: boolean;
    dryRun: boolean;
    listenMode: string;
    idleWindowSeconds: number;
    pollWindowSeconds: number;
    pollIntervalSeconds: number;
  };
  verification: {
    enabled: boolean;
    webdavUrl: string;
    webdavUsername: string;
    webdavPath: string;
    passwordConfigured: boolean;
  };
  envError?: string;
}

/** Returns null when SETTINGS_KEY is missing, invalid, or still the example placeholder. */
export function getSettingsKeyBytes(env: Env): Uint8Array | null {
  const value = env.SETTINGS_KEY?.trim();
  if (!value || value.startsWith('replace-')) {
    return null;
  }
  if (/^[0-9a-f]{64}$/i.test(value)) {
    const bytes = new Uint8Array(KEY_BYTES);
    for (let index = 0; index < KEY_BYTES; index++) {
      bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }
  try {
    const bytes = base64ToBytes(value);
    return bytes.length === KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

export function settingsKeyConfigured(env: Env): boolean {
  return getSettingsKeyBytes(env) !== null;
}

export async function hasStoredSettings(env: Env): Promise<boolean> {
  if (!env.MAIL2TG_KV) {
    return false;
  }
  return (await env.MAIL2TG_KV.get(KV_KEY)) !== null;
}

async function importKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSettings(
  settings: StoredSettings,
  rawKey: Uint8Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await importKey(rawKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(settings)),
  );
  return JSON.stringify({
    v: 1,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
  });
}

function assertStoredSettingsShape(value: unknown): StoredSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('saved settings have an invalid format');
  }
  const record = value as Record<string, unknown>;
  const stringFields = ['telegramToken', 'chatId', 'junkChatId', 'language', 'timeZone', 'initialSync'];
  for (const field of stringFields) {
    if (typeof record[field] !== 'string') {
      throw new Error(`saved settings field ${field} is invalid`);
    }
  }
  for (const field of ['maxEmailChars', 'maxEmailBytes', 'maxMessagesPerRun']) {
    if (typeof record[field] !== 'number') {
      throw new Error(`saved settings field ${field} is invalid`);
    }
  }
  for (const field of ['loginNotify', 'dedupe', 'dryRun']) {
    if (typeof record[field] !== 'boolean') {
      throw new Error(`saved settings field ${field} is invalid`);
    }
  }
  if (!Array.isArray(record.mailboxes)) {
    throw new Error('saved settings field mailboxes is invalid');
  }
  return value as unknown as StoredSettings;
}

export async function decryptSettings(
  payload: string,
  rawKey: Uint8Array,
): Promise<StoredSettings> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('saved settings are not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('saved settings have an invalid format');
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1 || typeof record.iv !== 'string' || typeof record.data !== 'string') {
    throw new Error('saved settings have an invalid format');
  }

  const key = await importKey(rawKey);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
      key,
      base64ToBytes(record.data),
    );
  } catch {
    throw new Error(
      'could not decrypt saved settings; SETTINGS_KEY may have changed. Restore the correct key or reset the stored settings.',
    );
  }

  let settings: unknown;
  try {
    settings = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('decrypted settings are not valid JSON');
  }
  return assertStoredSettingsShape(settings);
}

export async function loadStoredSettings(env: Env): Promise<StoredSettings | null> {
  if (!env.MAIL2TG_KV) {
    return null;
  }
  const key = getSettingsKeyBytes(env);
  if (!key) {
    return null;
  }
  const payload = await env.MAIL2TG_KV.get(KV_KEY);
  if (!payload) {
    return null;
  }
  return decryptSettings(payload, key);
}

export async function saveStoredSettings(env: Env, settings: StoredSettings): Promise<void> {
  if (!env.MAIL2TG_KV) {
    throw new Error('MAIL2TG_KV binding is missing');
  }
  const key = getSettingsKeyBytes(env);
  if (!key) {
    throw new Error(
      'SETTINGS_KEY is not configured or invalid. Add a 32-byte key in Cloudflare, then try again.',
    );
  }
  const payload = await encryptSettings(settings, key);
  await env.MAIL2TG_KV.put(KV_KEY, payload);
}

export async function deleteStoredSettings(env: Env): Promise<void> {
  if (!env.MAIL2TG_KV) {
    throw new Error('MAIL2TG_KV binding is missing');
  }
  await env.MAIL2TG_KV.delete(KV_KEY);
}

export function maskSettings(
  settings: StoredSettings,
  source: 'kv' | 'env' | 'none',
  options: {
    settingsKeyConfigured: boolean;
    hasStoredSettings: boolean;
    envError?: string;
  },
): MaskedSettings {
  return {
    source,
    settingsKeyConfigured: options.settingsKeyConfigured,
    hasStoredSettings: options.hasStoredSettings,
    telegram: {
      tokenConfigured: settings.telegramToken !== '',
      chatId: settings.chatId,
      junkChatId: settings.junkChatId,
    },
    mailboxes: settings.mailboxes.map((mailbox) => ({
      email: mailbox.email,
      host: mailbox.host,
      port: mailbox.port,
      ...(mailbox.folders ? { folders: mailbox.folders } : {}),
      ...(mailbox.name ? { name: mailbox.name } : {}),
      passwordConfigured: mailbox.password !== '',
    })),
    general: {
      language: settings.language,
      timeZone: settings.timeZone,
      maxEmailChars: settings.maxEmailChars,
      maxEmailBytes: settings.maxEmailBytes,
      maxMessagesPerRun: settings.maxMessagesPerRun,
      initialSync: settings.initialSync,
      loginNotify: settings.loginNotify,
      dedupe: settings.dedupe,
      dryRun: settings.dryRun,
      listenMode: settings.listenMode ?? 'poll',
      idleWindowSeconds: settings.idleWindowSeconds ?? 40,
      pollWindowSeconds: settings.pollWindowSeconds ?? 45,
      pollIntervalSeconds: settings.pollIntervalSeconds ?? 20,
    },
    verification: {
      enabled: Boolean(settings.verification?.enabled),
      webdavUrl: settings.verification?.webdavUrl ?? '',
      webdavUsername: settings.verification?.webdavUsername ?? '',
      webdavPath: settings.verification?.webdavPath ?? 'SyncClipboard.json',
      passwordConfigured: Boolean(settings.verification?.webdavPassword),
    },
    ...(options.envError ? { envError: options.envError } : {}),
  };
}

function asObject(value: unknown, field: string): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = record[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }
  return value.trim();
}

function readOptionalNumber(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = record[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = record[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function normalizeSubmittedMailbox(
  value: unknown,
  index: number,
  existing: StoredSettings,
): StoredMailbox {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`mailboxes[${index}] must be an object`);
  }
  const record = value as Record<string, unknown>;

  const email = readOptionalString(record, 'email', '');
  if (!email) {
    throw new Error(`mailboxes[${index}].email is required`);
  }

  const host = readOptionalString(record, 'host', '');
  if (!host) {
    throw new Error(`mailboxes[${index}].host is required`);
  }

  const portValue = record.port;
  const port =
    typeof portValue === 'number'
      ? portValue
      : typeof portValue === 'string' && portValue.trim() !== ''
        ? Number.parseInt(portValue, 10)
        : 993;
  if (!Number.isInteger(port)) {
    throw new Error(`mailboxes[${index}].port must be an integer`);
  }

  let folders: string[] | undefined;
  const foldersValue = record.folders;
  if (foldersValue !== undefined && foldersValue !== null) {
    if (!Array.isArray(foldersValue)) {
      throw new Error(`mailboxes[${index}].folders must be an array`);
    }
    folders = foldersValue.map((folder, folderIndex) => {
      if (typeof folder !== 'string' || folder.trim() === '') {
        throw new Error(`mailboxes[${index}].folders[${folderIndex}] must be a string`);
      }
      return folder.trim();
    });
    if (folders.length === 0) {
      folders = undefined;
    }
  }

  const name = readOptionalString(record, 'name', '');

  const passwordValue = record.password;
  if (passwordValue !== undefined && typeof passwordValue !== 'string') {
    throw new Error(`mailboxes[${index}].password must be a string`);
  }
  let password = passwordValue?.trim() ? passwordValue : '';
  if (!password) {
    const previous = existing.mailboxes.find(
      (mailbox) => mailbox.email.toLowerCase() === email.toLowerCase(),
    );
    if (!previous) {
      throw new Error(`mailboxes[${index}] requires a password because it is a new mailbox`);
    }
    password = previous.password;
  }

  return {
    email,
    password,
    host,
    port,
    ...(folders ? { folders } : {}),
    ...(name ? { name } : {}),
  };
}

/**
 * Applies a submitted settings form on top of existing settings. Empty Telegram
 * token and empty mailbox passwords mean "keep the existing secret".
 */
export function mergeSubmittedSettings(
  existing: StoredSettings,
  submitted: unknown,
): StoredSettings {
  const root = asObject(submitted, 'settings');
  if (!root) {
    throw new Error('settings body is required');
  }

  const telegram = asObject(root.telegram, 'telegram');
  let telegramToken = existing.telegramToken;
  if (telegram) {
    const tokenValue = telegram.token;
    if (tokenValue !== undefined) {
      if (typeof tokenValue !== 'string') {
        throw new Error('telegram.token must be a string');
      }
      if (tokenValue.trim() !== '') {
        telegramToken = tokenValue.trim();
      }
    }
  }

  const general = asObject(root.general, 'general');
  type GeneralSettings = Pick<
    StoredSettings,
    | 'language'
    | 'timeZone'
    | 'maxEmailChars'
    | 'maxEmailBytes'
    | 'maxMessagesPerRun'
    | 'initialSync'
    | 'loginNotify'
    | 'dedupe'
    | 'dryRun'
    | 'listenMode'
    | 'idleWindowSeconds'
    | 'pollWindowSeconds'
    | 'pollIntervalSeconds'
  >;
  const nextGeneral: GeneralSettings = {
    language: existing.language,
    timeZone: existing.timeZone,
    maxEmailChars: existing.maxEmailChars,
    maxEmailBytes: existing.maxEmailBytes,
    maxMessagesPerRun: existing.maxMessagesPerRun,
    initialSync: existing.initialSync,
    loginNotify: existing.loginNotify,
    dedupe: existing.dedupe,
    dryRun: existing.dryRun,
    listenMode: existing.listenMode ?? 'poll',
    idleWindowSeconds: existing.idleWindowSeconds ?? 40,
    pollWindowSeconds: existing.pollWindowSeconds ?? 45,
    pollIntervalSeconds: existing.pollIntervalSeconds ?? 20,
  };
  if (general) {
    if (general.language !== undefined) {
      if (general.language !== 'Chinese' && general.language !== 'English') {
        throw new Error('general.language must be "Chinese" or "English"');
      }
      nextGeneral.language = general.language;
    }
    nextGeneral.timeZone = readOptionalString(general, 'timeZone', existing.timeZone);
    nextGeneral.maxEmailChars = readOptionalNumber(
      general,
      'maxEmailChars',
      existing.maxEmailChars,
    );
    nextGeneral.maxEmailBytes = readOptionalNumber(
      general,
      'maxEmailBytes',
      existing.maxEmailBytes,
    );
    nextGeneral.maxMessagesPerRun = readOptionalNumber(
      general,
      'maxMessagesPerRun',
      existing.maxMessagesPerRun,
    );
    if (general.initialSync !== undefined) {
      if (general.initialSync !== 'skip' && general.initialSync !== 'latest') {
        throw new Error('general.initialSync must be "skip" or "latest"');
      }
      nextGeneral.initialSync = general.initialSync;
    }
    if (general.listenMode !== undefined) {
      if (general.listenMode !== 'poll' && general.listenMode !== 'idle') {
        throw new Error('general.listenMode must be "poll" or "idle"');
      }
      nextGeneral.listenMode = general.listenMode;
    }
    nextGeneral.idleWindowSeconds = readOptionalNumber(
      general,
      'idleWindowSeconds',
      existing.idleWindowSeconds ?? 40,
    );
    nextGeneral.pollWindowSeconds = readOptionalNumber(
      general,
      'pollWindowSeconds',
      existing.pollWindowSeconds ?? 45,
    );
    nextGeneral.pollIntervalSeconds = readOptionalNumber(
      general,
      'pollIntervalSeconds',
      existing.pollIntervalSeconds ?? 20,
    );
    nextGeneral.loginNotify = readOptionalBoolean(
      general,
      'loginNotify',
      existing.loginNotify,
    );
    nextGeneral.dedupe = readOptionalBoolean(general, 'dedupe', existing.dedupe);
    nextGeneral.dryRun = readOptionalBoolean(general, 'dryRun', existing.dryRun);
  }

  let mailboxes = existing.mailboxes;
  if (root.mailboxes !== undefined) {
    if (!Array.isArray(root.mailboxes)) {
      throw new Error('mailboxes must be an array');
    }
    if (root.mailboxes.length > 50) {
      throw new Error('too many mailboxes configured (max 50)');
    }
    mailboxes = root.mailboxes.map((mailbox, index) =>
      normalizeSubmittedMailbox(mailbox, index, existing),
    );
  }

  const previousVerification = existing.verification ?? EMPTY_VERIFICATION;
  let verification = previousVerification;
  const verificationInput = asObject(root.verification, 'verification');
  if (verificationInput) {
    let webdavPassword = previousVerification.webdavPassword;
    const passwordValue = verificationInput.webdavPassword;
    if (passwordValue !== undefined) {
      if (typeof passwordValue !== 'string') {
        throw new Error('verification.webdavPassword must be a string');
      }
      if (passwordValue.trim() !== '') {
        webdavPassword = passwordValue;
      }
    }
    verification = {
      enabled: readOptionalBoolean(
        verificationInput,
        'enabled',
        previousVerification.enabled,
      ),
      webdavUrl: readOptionalString(
        verificationInput,
        'webdavUrl',
        previousVerification.webdavUrl,
      ),
      webdavUsername: readOptionalString(
        verificationInput,
        'webdavUsername',
        previousVerification.webdavUsername,
      ),
      webdavPassword,
      webdavPath: readOptionalString(
        verificationInput,
        'webdavPath',
        previousVerification.webdavPath,
      ),
    };
  }

  return {
    telegramToken,
    chatId: telegram ? readOptionalString(telegram, 'chatId', existing.chatId) : existing.chatId,
    junkChatId: telegram
      ? readOptionalString(telegram, 'junkChatId', existing.junkChatId)
      : existing.junkChatId,
    ...nextGeneral,
    mailboxes,
    verification,
  };
}
