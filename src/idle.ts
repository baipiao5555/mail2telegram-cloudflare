import type { AppConfig, Env, Mailbox } from './env';
import { ImapClient } from './imap/client';
import type { FolderInfo } from './imap/parser';
import {
  buildLoginMessage,
  pollFolder,
  resolveFolders,
  type FolderSummary,
  type MailboxSummary,
} from './poll';
import { StateStore, type AccountStatus } from './state';
import {
  makeSenderOptions,
  sendTelegramText,
  telegramErrorForLog,
  type TelegramSenderOptions,
} from './telegram';
import { errorMessage, sleep } from './util';

const DISCOVERY_BUDGET_MS = 30_000;
const POST_WINDOW_BUDGET_MS = 30_000;
const FALLBACK_POLL_INTERVAL_MS = 20_000;

export interface IdleOptions {
  windowMs?: number;
}

export interface WindowOptions {
  mode: 'idle' | 'poll';
  windowMs: number;
  intervalMs: number;
}

export interface WindowSummary {
  startedAt: string;
  finishedAt: string;
  listenMode: 'idle' | 'poll';
  windowSeconds: number;
  intervalSeconds: number;
  mailboxes: MailboxSummary[];
}

export type IdleSummary = WindowSummary;

function mergeSummary(target: FolderSummary, next: FolderSummary): void {
  target.newMessages += next.newMessages;
  target.forwarded += next.forwarded;
  target.skipped += next.skipped;
  target.lastUid = next.lastUid;
  target.uidValidity = next.uidValidity;
  target.remaining = next.remaining;
  if (next.error) {
    target.error = next.error;
  }
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) {
        return;
      }
      results[index] = await tasks[index]!();
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function clientFor(
  mailbox: Mailbox,
  config: AppConfig,
  deadline: number,
): ImapClient {
  return new ImapClient({
    host: mailbox.host,
    port: mailbox.port,
    deadline,
    maxLiteralBytes: Math.min(config.maxEmailBytes + 2 * 1024 * 1024, 32 * 1024 * 1024),
  });
}

async function persistStatus(
  store: StateStore,
  mailbox: Mailbox,
  status: AccountStatus,
): Promise<void> {
  try {
    await store.setStatus(mailbox.id, status);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'status-write-failed',
        mailbox: mailbox.email,
        error: errorMessage(error),
      }),
    );
  }
}

async function sendLoginNotification(
  config: AppConfig,
  mailbox: Mailbox,
  store: StateStore,
  sender: TelegramSenderOptions,
): Promise<boolean> {
  if (!config.loginNotify || (await store.isLoginNotified(mailbox.id))) {
    return false;
  }
  try {
    await sendTelegramText(sender, config.chatId, buildLoginMessage(config, mailbox));
    await store.markLoginNotified(mailbox.id);
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'login-notification-failed',
        mailbox: mailbox.email,
        error: telegramErrorForLog(error, config.telegramToken),
      }),
    );
    return false;
  }
}

async function watchFolder(
  config: AppConfig,
  mailbox: Mailbox,
  folder: FolderInfo,
  store: StateStore,
  sender: TelegramSenderOptions,
  options: WindowOptions,
): Promise<FolderSummary> {
  const summary: FolderSummary = {
    name: folder.name,
    isJunk: folder.name.toUpperCase() !== 'INBOX',
    newMessages: 0,
    forwarded: 0,
    skipped: 0,
    lastUid: 0,
    uidValidity: 0,
    remaining: 0,
  };

  const client = clientFor(
    mailbox,
    config,
    Date.now() + options.windowMs + POST_WINDOW_BUDGET_MS,
  );
  let useIdle = false;

  try {
    await client.connect();
    await client.login(mailbox.email, mailbox.password);
    mergeSummary(summary, await pollFolder(client, mailbox, folder, config, sender, store));

    const endAt = Date.now() + options.windowMs;
    useIdle = options.mode === 'idle' && client.capabilities.has('IDLE');

    while (Date.now() < endAt) {
      if (useIdle) {
        try {
          await client.startIdle();
        } catch {
          useIdle = false;
          continue;
        }

        try {
          await client.waitForIdleEvent(Math.max(1, endAt - Date.now()));
        } catch (error) {
          summary.error = errorMessage(error);
          break;
        }

        if (Date.now() >= endAt) {
          break;
        }
      } else {
        const wait = Math.min(options.intervalMs, Math.max(1, endAt - Date.now()));
        if (wait <= 0) {
          break;
        }
        await sleep(wait);
        if (Date.now() >= endAt) {
          break;
        }
      }

      try {
        mergeSummary(
          summary,
          await pollFolder(client, mailbox, folder, config, sender, store),
        );
      } catch (error) {
        summary.error = errorMessage(error);
        break;
      }
    }
  } catch (error) {
    summary.error = errorMessage(error);
  } finally {
    await client.close();
  }

  return summary;
}

async function idleAccount(
  config: AppConfig,
  mailbox: Mailbox,
  store: StateStore,
  sender: TelegramSenderOptions,
  options: WindowOptions,
  now: Date,
): Promise<MailboxSummary> {
  const summary: MailboxSummary = { email: mailbox.email, folders: [] };
  const previous = await store.getStatus(mailbox.id);
  const status: AccountStatus = {
    email: mailbox.email,
    lastRunAt: now.toISOString(),
    folders: { ...(previous?.folders ?? {}) },
  };
  let dirty = false;

  const discovery = clientFor(mailbox, config, Date.now() + DISCOVERY_BUDGET_MS);
  let folders: FolderInfo[] = [];

  try {
    await discovery.connect();
    await discovery.login(mailbox.email, mailbox.password);
    if (await sendLoginNotification(config, mailbox, store, sender)) {
      dirty = true;
    }
    folders = resolveFolders(mailbox, await discovery.list());
  } catch (error) {
    const message = telegramErrorForLog(error, config.telegramToken);
    summary.error = message;
    status.lastError = message;
    console.error(
      JSON.stringify({ event: 'idle-discovery-failed', mailbox: mailbox.email, error: message }),
    );
    await discovery.close();
    await persistStatus(store, mailbox, status);
    return summary;
  }
  await discovery.close();

  const tasks = folders.map(
    (folder) => async (): Promise<FolderSummary> => {
      try {
        return await watchFolder(config, mailbox, folder, store, sender, options);
      } catch (error) {
        return {
          name: folder.name,
          isJunk: folder.name.toUpperCase() !== 'INBOX',
          newMessages: 0,
          forwarded: 0,
          skipped: 0,
          lastUid: 0,
          uidValidity: 0,
          remaining: 0,
          error: errorMessage(error),
        };
      }
    },
  );

  const folderResults = await runWithConcurrency(tasks, 6);
  for (const folderSummary of folderResults) {
    summary.folders.push(folderSummary);
    status.folders[folderSummary.name] = {
      uid: folderSummary.lastUid,
      uidValidity: folderSummary.uidValidity,
      ...(folderSummary.forwarded > 0 ? { lastForwardedAt: new Date().toISOString() } : {}),
    };
    if (folderSummary.forwarded > 0) {
      dirty = true;
    }
    if (folderSummary.error) {
      status.lastError = folderSummary.error;
      dirty = true;
    }
    console.log(
      JSON.stringify({
        event: 'idle-folder-finished',
        mailbox: mailbox.email,
        folder: folderSummary.name,
        newMessages: folderSummary.newMessages,
        forwarded: folderSummary.forwarded,
        skipped: folderSummary.skipped,
        error: folderSummary.error,
      }),
    );
  }

  if (!status.lastError && previous?.lastError) {
    dirty = true;
  }
  const stale =
    !previous?.lastRunAt ||
    now.getTime() - Date.parse(previous.lastRunAt) > 60 * 60 * 1000;
  if (dirty || stale) {
    await persistStatus(store, mailbox, status);
  }

  return summary;
}

/**
 * Holds IMAP connections for one cron invocation. In idle mode the server
 * pushes EXISTS notifications; in poll mode the folder is checked every
 * intervalMs. Workers cannot keep a connection alive across invocations, so the
 * window should be shorter than the cron interval.
 */
async function windowAll(
  env: Env,
  config: AppConfig,
  options: WindowOptions,
): Promise<WindowSummary> {
  if (!env.MAIL2TG_KV) {
    throw new Error('MAIL2TG_KV binding is missing');
  }
  if (!config.telegramToken && !config.dryRun) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }
  if (!config.chatId && !config.dryRun) {
    throw new Error('TELEGRAM_CHAT_ID is not configured');
  }

  const now = new Date();
  const startedAt = now.toISOString();
  const store = new StateStore(env.MAIL2TG_KV);
  const sender = makeSenderOptions(config.telegramToken, config.chatId, config.dryRun);

  const tasks = config.mailboxes.map(
    (mailbox) => async (): Promise<MailboxSummary> => {
      try {
        return await idleAccount(config, mailbox, store, sender, options, now);
      } catch (error) {
        const message = telegramErrorForLog(error, config.telegramToken);
        console.error(
          JSON.stringify({
            event: 'window-mailbox-crashed',
            mailbox: mailbox.email,
            error: message,
          }),
        );
        return { email: mailbox.email, folders: [], error: message };
      }
    },
  );

  const mailboxes = await runWithConcurrency(tasks, 4);

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    listenMode: options.mode,
    windowSeconds: Math.round(options.windowMs / 1000),
    intervalSeconds: Math.round(options.intervalMs / 1000),
    mailboxes,
  };
}

export async function idleAll(
  env: Env,
  config: AppConfig,
  options: IdleOptions = {},
): Promise<WindowSummary> {
  const windowMs = Math.max(
    10_000,
    options.windowMs ?? config.idleWindowSeconds * 1000,
  );
  return windowAll(env, config, {
    mode: 'idle',
    windowMs,
    intervalMs: FALLBACK_POLL_INTERVAL_MS,
  });
}

export async function pollWindowAll(
  env: Env,
  config: AppConfig,
): Promise<WindowSummary> {
  const windowMs = Math.max(10_000, config.pollWindowSeconds * 1000);
  const intervalMs = Math.max(5_000, config.pollIntervalSeconds * 1000);
  return windowAll(env, config, {
    mode: 'poll',
    windowMs,
    intervalMs,
  });
}
