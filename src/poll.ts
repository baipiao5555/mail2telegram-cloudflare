import type { AppConfig, Mailbox, Env } from './env';
import { ImapClient } from './imap/client';
import {
  isJunkFolder,
  isSelectableFolder,
  type FolderInfo,
} from './imap/parser';
import { detectForwarding, parseHeaderBlock, parseRawEmail, type ParsedMail } from './mail';
import { StateStore, type AccountStatus } from './state';
import { sendTelegramText, telegramErrorForLog, type TelegramSenderOptions } from './telegram';
import { extractVerificationCode } from './verification';
import { pushSyncClipboardText } from './webdav';
import {
  errorMessage,
  escapeHtml,
  formatDateTime,
  truncate,
} from './util';

const ACCOUNT_TIME_BUDGET_MS = 60_000;
const STATUS_REFRESH_MS = 60 * 60 * 1000;

export interface PollDeps {
  /** Test-only: allows the integration test to connect to a local fake IMAP server. */
  allowPrivateRemote?: boolean;
  now?: () => Date;
}

export interface FolderSummary {
  name: string;
  isJunk: boolean;
  newMessages: number;
  forwarded: number;
  skipped: number;
  lastUid: number;
  uidValidity: number;
  remaining: number;
  error?: string;
}

export interface MailboxSummary {
  email: string;
  folders: FolderSummary[];
  error?: string;
}

export interface PollSummary {
  startedAt: string;
  finishedAt: string;
  mailboxes: MailboxSummary[];
}

interface MessageContext {
  config: AppConfig;
  mailbox: Mailbox;
  isJunk: boolean;
  sender: TelegramSenderOptions;
  store: StateStore;
  summary: FolderSummary;
}

function languageStrings(language: AppConfig['language']) {
  if (language === 'English') {
    return {
      subject: 'Subject: ',
      newMailFrom: 'New email from ',
      sender: 'Sender: ',
      date: 'Date: ',
      content: 'Content:',
      noSubject: '(no subject)',
      unknownSender: '(unknown sender)',
      noContent: '(no content)',
      login: (email: string) => `Successfully logged into mailbox ${email}`,
      tooLarge: (size: string) => `The message is ${size}, larger than MAX_EMAIL_BYTES. The body was not forwarded.`,
    };
  }
  return {
    subject: '主题: ',
    newMailFrom: '新邮件来自 ',
    sender: '发件人: ',
    date: '日期: ',
    content: '内容:',
    noSubject: '(无主题)',
    unknownSender: '(未知发件人)',
    noContent: '(无内容)',
    login: (email: string) => `成功登录邮箱 ${email}`,
    tooLarge: (size: string) => `邮件大小 ${size}，超过 MAX_EMAIL_BYTES 限制，未转发正文。`,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildMailMessage(config: AppConfig, mail: ParsedMail, shownAccount: string, from: string): string {
  const strings = languageStrings(config.language);
  const subject = truncate(mail.subject || strings.noSubject, 300);
  const sender = truncate(from || strings.unknownSender, 300);
  const account = truncate(shownAccount, 300);
  const plainContent = truncate(mail.content || strings.noContent, config.maxEmailChars);
  const header =
    `<b>${strings.subject}</b>${escapeHtml(subject)}\n` +
    `<b>${strings.newMailFrom}${escapeHtml(account)}:</b>\n` +
    `<b>${strings.sender}</b>${escapeHtml(sender)}\n` +
    `<b>${strings.date}</b>${formatDateTime(mail.date, config.timeZone)}\n\n` +
    `<b>${strings.content}</b>\n`;

  const useHtml =
    mail.contentHtml !== undefined &&
    mail.content.length <= config.maxEmailChars &&
    header.length + mail.contentHtml.length <= 3800;
  const content = useHtml ? mail.contentHtml! : escapeHtml(plainContent);
  return header + content;
}

function buildOversizeMessage(
  config: AppConfig,
  subject: string,
  shownAccount: string,
  from: string,
  date: string | undefined,
  size: number,
): string {
  const strings = languageStrings(config.language);
  return (
    `<b>${strings.subject}</b>${escapeHtml(truncate(subject || strings.noSubject, 300))}\n` +
    `<b>${strings.newMailFrom}${escapeHtml(truncate(shownAccount, 300))}:</b>\n` +
    `<b>${strings.sender}</b>${escapeHtml(truncate(from || strings.unknownSender, 300))}\n` +
    `<b>${strings.date}</b>${formatDateTime(date, config.timeZone)}\n\n` +
    `${escapeHtml(strings.tooLarge(formatBytes(size)))}`
  );
}

function withHeaderTerminator(bytes: Uint8Array): Uint8Array {
  const suffix = new TextEncoder().encode('\r\n\r\n');
  const merged = new Uint8Array(bytes.length + suffix.length);
  merged.set(bytes, 0);
  merged.set(suffix, bytes.length);
  return merged;
}

function chatIdFor(config: AppConfig, isJunk: boolean): string {
  return isJunk ? config.junkChatId : config.chatId;
}

async function processMessage(
  client: ImapClient,
  uid: number,
  context: MessageContext,
): Promise<void> {
  const { config, mailbox, isJunk, sender, store, summary } = context;
  const chatId = chatIdFor(config, isJunk);
  if (!chatId) {
    summary.skipped += 1;
    return;
  }

  const size = await client.fetchSize(uid);
  if (size !== null && size > config.maxEmailBytes) {
    const headerBytes = await client.fetchHeaders(uid);
    const preview = await parseHeaderBlock(withHeaderTerminator(headerBytes));

    if (config.dedupe && (await store.isDuplicate(mailbox.id, preview.messageId))) {
      summary.skipped += 1;
      return;
    }

    const forward = detectForwarding(
      {
        subject: preview.subject,
        from: preview.from,
        date: preview.date,
        messageId: preview.messageId,
        deliveredTo: preview.deliveredTo,
        xOriginalTo: preview.xOriginalTo,
        toHeader: preview.toHeader,
        content: '',
        attachments: 0,
      },
      mailbox.email,
    );

    const message = buildOversizeMessage(
      config,
      preview.subject,
      forward.shownAccount,
      forward.from,
      preview.date,
      size,
    );
    await sendTelegramText(sender, chatId, message);
    summary.forwarded += 1;
    if (config.dedupe) {
      await store.markSeen(mailbox.id, preview.messageId);
    }
    return;
  }

  const raw = await client.fetchRaw(uid);
  const mail = await parseRawEmail(raw);
  const forward = detectForwarding(mail, mailbox.email);

  if (config.dedupe && (await store.isDuplicate(mailbox.id, mail.messageId))) {
    summary.skipped += 1;
    return;
  }

  if (config.verification?.enabled) {
    const code = extractVerificationCode(`${mail.subject}\n${mail.content}`);
    if (code) {
      try {
        await pushSyncClipboardText(config.verification, code);
        console.log(
          JSON.stringify({
            event: 'verification-code-pushed',
            mailbox: mailbox.email,
            codeLength: code.length,
          }),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'verification-code-push-failed',
            mailbox: mailbox.email,
            error: errorMessage(error),
          }),
        );
      }
    }
  }

  const message = buildMailMessage(config, mail, forward.shownAccount, forward.from);
  await sendTelegramText(sender, chatId, message);
  summary.forwarded += 1;

  if (config.dedupe) {
    await store.markSeen(mailbox.id, mail.messageId);
  }
}

async function pollFolder(
  client: ImapClient,
  mailbox: Mailbox,
  folder: FolderInfo,
  config: AppConfig,
  sender: TelegramSenderOptions,
  store: StateStore,
): Promise<FolderSummary> {
  const isJunk = folder.name.toUpperCase() !== 'INBOX';
  const summary: FolderSummary = {
    name: folder.name,
    isJunk,
    newMessages: 0,
    forwarded: 0,
    skipped: 0,
    lastUid: 0,
    uidValidity: 0,
    remaining: 0,
  };

  const selection = await client.select(folder.name);
  summary.uidValidity = selection.uidValidity;

  const cursor = await store.getCursor(mailbox.id, folder.name);
  const context: MessageContext = { config, mailbox, isJunk, sender, store, summary };

  if (!cursor || cursor.uidValidity !== selection.uidValidity) {
    const uids = await client.uidSearchAll();
    const maxUid = uids.length > 0 ? uids[uids.length - 1]! : 0;

    if (config.initialSync === 'latest' && maxUid > 0) {
      summary.newMessages += 1;
      await processMessage(client, maxUid, context);
    }
    summary.lastUid = maxUid;

    await store.setCursor(mailbox.id, folder.name, {
      uid: summary.lastUid,
      uidValidity: selection.uidValidity,
    });
    return summary;
  }

  summary.lastUid = cursor.uid;
  const uids = await client.uidSearchSince(cursor.uid);
  const batch = uids.slice(0, config.maxMessagesPerRun);
  summary.remaining = uids.length - batch.length;

  for (const uid of batch) {
    summary.newMessages += 1;
    await processMessage(client, uid, context);
    summary.lastUid = uid;
    await store.setCursor(mailbox.id, folder.name, {
      uid,
      uidValidity: selection.uidValidity,
    });
  }

  return summary;
}

function resolveFolders(mailbox: Mailbox, available: FolderInfo[]): FolderInfo[] {
  const selectable = available.filter(isSelectableFolder);
  const findByCaseInsensitiveName = (name: string): FolderInfo | undefined =>
    selectable.find((folder) => folder.name.toLowerCase() === name.toLowerCase());

  if (mailbox.folders && mailbox.folders.length > 0) {
    const result: FolderInfo[] = [];
    const seen = new Set<string>();
    for (const name of mailbox.folders) {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(findByCaseInsensitiveName(name) ?? { name, flags: [], delimiter: null });
    }
    return result;
  }

  const inbox =
    findByCaseInsensitiveName('INBOX') ?? { name: 'INBOX', flags: [], delimiter: null };
  const result: FolderInfo[] = [inbox];
  const junk = selectable.find(
    (folder) => folder.name.toUpperCase() !== 'INBOX' && isJunkFolder(folder),
  );
  if (junk) {
    result.push(junk);
  }
  return result;
}

async function pollMailbox(
  config: AppConfig,
  mailbox: Mailbox,
  store: StateStore,
  sender: TelegramSenderOptions,
  now: Date,
  deps: PollDeps,
): Promise<MailboxSummary> {
  const summary: MailboxSummary = { email: mailbox.email, folders: [] };
  const previousStatus = await store.getStatus(mailbox.id);
  const status: AccountStatus = {
    email: mailbox.email,
    lastRunAt: now.toISOString(),
    folders: { ...(previousStatus?.folders ?? {}) },
  };
  let dirty = false;

  const client = new ImapClient({
    host: mailbox.host,
    port: mailbox.port,
    deadline: Date.now() + ACCOUNT_TIME_BUDGET_MS,
    maxLiteralBytes: Math.min(config.maxEmailBytes + 2 * 1024 * 1024, 32 * 1024 * 1024),
    allowPrivateRemote: deps.allowPrivateRemote ?? false,
  });

  try {
    await client.connect();
    await client.login(mailbox.email, mailbox.password);

    if (config.loginNotify && !(await store.isLoginNotified(mailbox.id))) {
      try {
        const strings = languageStrings(config.language);
        await sendTelegramText(sender, config.chatId, `<b>${escapeHtml(strings.login(mailbox.email))}</b>`);
        await store.markLoginNotified(mailbox.id);
        dirty = true;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'login-notification-failed',
            mailbox: mailbox.email,
            error: telegramErrorForLog(error, config.telegramToken),
          }),
        );
      }
    }

    const folders = resolveFolders(mailbox, await client.list());
    for (const folder of folders) {
      const folderSummary = await pollFolder(client, mailbox, folder, config, sender, store);
      summary.folders.push(folderSummary);
      status.folders[folder.name] = {
        uid: folderSummary.lastUid,
        uidValidity: folderSummary.uidValidity,
        ...(folderSummary.forwarded > 0
          ? { lastForwardedAt: now.toISOString() }
          : {}),
      };
      if (folderSummary.forwarded > 0) {
        dirty = true;
      }
      if (folderSummary.remaining > 0) {
        console.warn(
          JSON.stringify({
            event: 'batch-limit-reached',
            mailbox: mailbox.email,
            folder: folder.name,
            remaining: folderSummary.remaining,
          }),
        );
      }
      console.log(
        JSON.stringify({
          event: 'folder-polled',
          mailbox: mailbox.email,
          folder: folder.name,
          newMessages: folderSummary.newMessages,
          forwarded: folderSummary.forwarded,
          skipped: folderSummary.skipped,
        }),
      );
    }
  } catch (error) {
    const message = telegramErrorForLog(error, config.telegramToken);
    summary.error = message;
    status.lastError = message;
    dirty = true;
    console.error(
      JSON.stringify({ event: 'mailbox-poll-failed', mailbox: mailbox.email, error: message }),
    );
  } finally {
    await client.logout();
  }

  if (!status.lastError && previousStatus?.lastError) {
    dirty = true;
  }

  const staleStatus =
    !previousStatus?.lastRunAt ||
    now.getTime() - Date.parse(previousStatus.lastRunAt) > STATUS_REFRESH_MS;
  if (dirty || staleStatus) {
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

  return summary;
}

export async function pollAll(
  env: Env,
  config: AppConfig,
  deps: PollDeps = {},
): Promise<PollSummary> {
  if (!env.MAIL2TG_KV) {
    throw new Error('MAIL2TG_KV binding is missing');
  }
  if (!config.telegramToken && !config.dryRun) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }
  if (!config.chatId && !config.dryRun) {
    throw new Error('TELEGRAM_CHAT_ID is not configured');
  }

  const now = deps.now?.() ?? new Date();
  const startedAt = now.toISOString();
  const store = new StateStore(env.MAIL2TG_KV);
  const sender: TelegramSenderOptions = {
    token: config.telegramToken,
    chatId: config.chatId,
    dryRun: config.dryRun,
  };

  const mailboxes: MailboxSummary[] = [];
  for (const mailbox of config.mailboxes) {
    try {
      mailboxes.push(await pollMailbox(config, mailbox, store, sender, now, deps));
    } catch (error) {
      const message = telegramErrorForLog(error, config.telegramToken);
      console.error(
        JSON.stringify({ event: 'mailbox-poll-crashed', mailbox: mailbox.email, error: message }),
      );
      mailboxes.push({ email: mailbox.email, folders: [], error: message });
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    mailboxes,
  };
}
