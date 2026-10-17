import { base64UrlEncode, sha256Hex } from './util';

export interface Cursor {
  uid: number;
  uidValidity: number;
}

export interface FolderStatus {
  uid: number;
  uidValidity: number;
  lastForwardedAt?: string;
}

export interface AccountStatus {
  email: string;
  lastRunAt?: string;
  lastError?: string;
  folders: Record<string, FolderStatus>;
}

function folderKey(folder: string): string {
  return base64UrlEncode(folder);
}

function cursorKey(accountId: string, folder: string): string {
  return `cursor:${accountId}:${folderKey(folder)}`;
}

function statusKey(accountId: string): string {
  return `status:${accountId}`;
}

function loginKey(accountId: string): string {
  return `login:${accountId}`;
}

function seenKey(accountId: string, messageIdHash: string): string {
  return `seen:${accountId}:${messageIdHash}`;
}

function parseCursor(value: unknown): Cursor | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const uid = record.uid;
  const uidValidity = record.uidValidity;
  if (
    typeof uid !== 'number' ||
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    typeof uidValidity !== 'number' ||
    !Number.isSafeInteger(uidValidity) ||
    uidValidity < 0
  ) {
    return null;
  }
  return { uid, uidValidity };
}

export class StateStore {
  constructor(private readonly kv: KVNamespace) {}

  async getCursor(accountId: string, folder: string): Promise<Cursor | null> {
    const value = await this.kv.get(cursorKey(accountId, folder), 'json');
    return parseCursor(value);
  }

  async setCursor(accountId: string, folder: string, cursor: Cursor): Promise<void> {
    await this.kv.put(cursorKey(accountId, folder), JSON.stringify(cursor));
  }

  async isLoginNotified(accountId: string): Promise<boolean> {
    return (await this.kv.get(loginKey(accountId))) !== null;
  }

  async markLoginNotified(accountId: string): Promise<void> {
    await this.kv.put(loginKey(accountId), new Date().toISOString());
  }

  async isDuplicate(accountId: string, messageId: string | undefined): Promise<boolean> {
    if (!messageId) {
      return false;
    }
    const hash = await sha256Hex(messageId);
    return (await this.kv.get(seenKey(accountId, hash))) !== null;
  }

  async markSeen(accountId: string, messageId: string | undefined): Promise<void> {
    if (!messageId) {
      return;
    }
    const hash = await sha256Hex(messageId);
    await this.kv.put(seenKey(accountId, hash), '1', { expirationTtl: 7 * 24 * 60 * 60 });
  }

  async getStatus(accountId: string): Promise<AccountStatus | null> {
    const value = await this.kv.get(statusKey(accountId), 'json');
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const record = value as Partial<AccountStatus>;
    if (typeof record.email !== 'string' || typeof record.folders !== 'object' || record.folders === null) {
      return null;
    }
    return {
      email: record.email,
      lastRunAt: typeof record.lastRunAt === 'string' ? record.lastRunAt : undefined,
      lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
      folders: record.folders,
    };
  }

  async setStatus(accountId: string, status: AccountStatus): Promise<void> {
    const safeStatus: AccountStatus = {
      email: status.email,
      lastRunAt: status.lastRunAt,
      lastError: status.lastError ? status.lastError.slice(0, 1000) : undefined,
      folders: status.folders,
    };
    await this.kv.put(statusKey(accountId), JSON.stringify(safeStatus), {
      expirationTtl: 30 * 24 * 60 * 60,
    });
  }
}
