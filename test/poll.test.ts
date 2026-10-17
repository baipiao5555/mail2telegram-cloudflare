import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, Env } from '../src/env';
import { pollAll } from '../src/poll';
import { StateStore } from '../src/state';
import { base64UrlEncode } from '../src/util';
import { FakeKV } from './helpers/fake-kv';
import { FakeImapServer } from './helpers/fake-imap';

interface SentMessage {
  chatId: string;
  text: string;
}

function rawEmail(options: {
  subject: string;
  messageId: string;
  content: string;
  from?: string;
  deliveredTo?: string;
}): string {
  return [
    `From: ${options.from ?? 'Alice <alice@example.com>'}`,
    'To: test@example.com',
    `Delivered-To: ${options.deliveredTo ?? 'test@example.com'}`,
    `Subject: ${options.subject}`,
    'Date: Sat, 17 Oct 2026 10:00:00 +0800',
    `Message-ID: <${options.messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    `<html><body><p>${options.content}</p></body></html>`,
  ].join('\r\n');
}

function makeConfig(port: number, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    telegramToken: '123456:ABC',
    chatId: '42',
    junkChatId: '',
    adminToken: '',
    language: 'Chinese',
    timeZone: 'Asia/Shanghai',
    maxEmailChars: 3000,
    maxEmailBytes: 10 * 1024 * 1024,
    maxMessagesPerRun: 20,
    initialSync: 'skip',
    loginNotify: false,
    dedupe: true,
    dryRun: false,
    mailboxes: [
      {
        id: 'test@example.com',
        email: 'test@example.com',
        password: 'secret',
        host: '127.0.0.1',
        port,
        folders: ['INBOX', 'Junk'],
      },
    ],
    ...overrides,
  };
}

let server: FakeImapServer;
let kv: FakeKV;
let sent: SentMessage[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  server = new FakeImapServer();
  server.addFolder('INBOX', 1000);
  server.addFolder('Junk', 2000, true);
  server.addMessage(
    'INBOX',
    1,
    rawEmail({ subject: 'old one', messageId: 'old1@example.com', content: 'old one' }),
  );
  server.addMessage(
    'INBOX',
    2,
    rawEmail({ subject: 'old two', messageId: 'old2@example.com', content: 'old two' }),
  );
  server.addMessage(
    'Junk',
    1,
    rawEmail({ subject: 'old junk', messageId: 'oldjunk@example.com', content: 'old junk' }),
  );
  await server.start();

  kv = new FakeKV();
  sent = [];
  fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { chat_id: string; text: string };
    sent.push({ chatId: body.chat_id, text: body.text });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await server.close();
});

function env(): Env {
  return { MAIL2TG_KV: kv as unknown as KVNamespace };
}

function store(): StateStore {
  return new StateStore(kv as unknown as KVNamespace);
}

describe('pollAll integration', () => {
  it('baselines on first run, notifies login, then forwards only new mail', async () => {
    const config = makeConfig(server.port, { loginNotify: true });

    const first = await pollAll(env(), config, { allowPrivateRemote: true });
    expect(first.mailboxes[0]?.error).toBeUndefined();
    expect(first.mailboxes[0]?.folders.map((folder) => folder.newMessages)).toEqual([0, 0]);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe('42');
    expect(sent[0]?.text).toContain('成功登录邮箱 test@example.com');

    expect(await store().getCursor('test@example.com', 'INBOX')).toEqual({
      uid: 2,
      uidValidity: 1000,
    });
    expect(await store().getCursor('test@example.com', 'Junk')).toEqual({
      uid: 1,
      uidValidity: 2000,
    });

    const second = await pollAll(env(), config, { allowPrivateRemote: true });
    expect(second.mailboxes[0]?.folders.map((folder) => folder.newMessages)).toEqual([0, 0]);
    expect(sent).toHaveLength(1);

    server.addMessage(
      'INBOX',
      3,
      rawEmail({ subject: 'new inbox', messageId: 'new3@example.com', content: 'body three' }),
    );
    server.addMessage(
      'Junk',
      2,
      rawEmail({ subject: 'new junk', messageId: 'newjunk2@example.com', content: 'junk body' }),
    );

    const third = await pollAll(
      env(),
      makeConfig(server.port, { loginNotify: true, junkChatId: '99' }),
      { allowPrivateRemote: true },
    );
    expect(third.mailboxes[0]?.folders.map((folder) => folder.forwarded)).toEqual([1, 1]);
    expect(sent).toHaveLength(3);

    const inboxMessage = sent[1]!;
    expect(inboxMessage.chatId).toBe('42');
    expect(inboxMessage.text).toContain('new inbox');
    expect(inboxMessage.text).toContain('body three');
    expect(inboxMessage.text).toContain('新邮件来自 test@example.com');

    const junkMessage = sent[2]!;
    expect(junkMessage.chatId).toBe('99');
    expect(junkMessage.text).toContain('new junk');
    expect(junkMessage.text).toContain('junk body');

    expect(await store().getCursor('test@example.com', 'INBOX')).toEqual({
      uid: 3,
      uidValidity: 1000,
    });
    expect(await store().getCursor('test@example.com', 'Junk')).toEqual({
      uid: 2,
      uidValidity: 2000,
    });

    const fourth = await pollAll(env(), config, { allowPrivateRemote: true });
    expect(fourth.mailboxes[0]?.folders.map((folder) => folder.newMessages)).toEqual([0, 0]);
    expect(sent).toHaveLength(3);
  });

  it('does not re-send the latest message when deduplication sees it again', async () => {
    await pollAll(env(), makeConfig(server.port), { allowPrivateRemote: true });
    expect(sent).toHaveLength(0);

    server.addMessage(
      'INBOX',
      3,
      rawEmail({ subject: 'dedupe me', messageId: 'dedupe@example.com', content: 'dedupe body' }),
    );
    await pollAll(env(), makeConfig(server.port), { allowPrivateRemote: true });
    expect(sent).toHaveLength(1);

    await kv.delete(`cursor:test@example.com:${base64UrlEncode('INBOX')}`);
    const summary = await pollAll(
      env(),
      makeConfig(server.port, { initialSync: 'latest' }),
      { allowPrivateRemote: true },
    );
    expect(sent).toHaveLength(1);
    expect(summary.mailboxes[0]?.folders[0]?.skipped).toBe(1);
    expect(await store().getCursor('test@example.com', 'INBOX')).toEqual({
      uid: 3,
      uidValidity: 1000,
    });
  });

  it('resets the baseline when UIDVALIDITY changes', async () => {
    await pollAll(env(), makeConfig(server.port), { allowPrivateRemote: true });
    expect(sent).toHaveLength(0);

    server.setUidValidity('INBOX', 5000);
    server.addMessage(
      'INBOX',
      3,
      rawEmail({ subject: 'after reset', messageId: 'reset@example.com', content: 'ignored' }),
    );
    const summary = await pollAll(env(), makeConfig(server.port), { allowPrivateRemote: true });
    expect(summary.mailboxes[0]?.folders[0]?.forwarded).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await store().getCursor('test@example.com', 'INBOX')).toEqual({
      uid: 3,
      uidValidity: 5000,
    });

    server.addMessage(
      'INBOX',
      4,
      rawEmail({ subject: 'fresh', messageId: 'fresh@example.com', content: 'fresh body' }),
    );
    await pollAll(env(), makeConfig(server.port), { allowPrivateRemote: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('fresh');
  });

  it('skips junk fetching when no junk chat is configured but still advances the cursor', async () => {
    await pollAll(env(), makeConfig(server.port), { allowPrivateRemote: true });
    server.addMessage(
      'Junk',
      2,
      rawEmail({ subject: 'junk no chat', messageId: 'junknochat@example.com', content: 'x' }),
    );
    const summary = await pollAll(env(), makeConfig(server.port), { allowPrivateRemote: true });
    expect(summary.mailboxes[0]?.folders[1]?.skipped).toBe(1);
    expect(summary.mailboxes[0]?.folders[1]?.forwarded).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await store().getCursor('test@example.com', 'Junk')).toEqual({
      uid: 2,
      uidValidity: 2000,
    });
  });

  it('caps messages per folder per run and continues next run', async () => {
    await pollAll(env(), makeConfig(server.port), { allowPrivateRemote: true });
    server.addMessage(
      'INBOX',
      3,
      rawEmail({ subject: 'cap 1', messageId: 'cap1@example.com', content: 'one' }),
    );
    server.addMessage(
      'INBOX',
      4,
      rawEmail({ subject: 'cap 2', messageId: 'cap2@example.com', content: 'two' }),
    );

    const config = makeConfig(server.port, { maxMessagesPerRun: 1, junkChatId: '99' });
    const first = await pollAll(env(), config, { allowPrivateRemote: true });
    expect(first.mailboxes[0]?.folders[0]?.forwarded).toBe(1);
    expect(first.mailboxes[0]?.folders[0]?.remaining).toBe(1);
    expect(sent).toHaveLength(1);

    const second = await pollAll(env(), config, { allowPrivateRemote: true });
    expect(second.mailboxes[0]?.folders[0]?.forwarded).toBe(1);
    expect(sent).toHaveLength(2);
    expect(await store().getCursor('test@example.com', 'INBOX')).toEqual({
      uid: 4,
      uidValidity: 1000,
    });
  });

  it('sends a notice for messages larger than the size limit', async () => {
    await pollAll(env(), makeConfig(server.port), { allowPrivateRemote: true });
    const hugeBody = 'x'.repeat(2000);
    server.addMessage(
      'INBOX',
      3,
      rawEmail({ subject: 'huge', messageId: 'huge@example.com', content: hugeBody }),
    );

    const summary = await pollAll(
      env(),
      makeConfig(server.port, { maxEmailBytes: 1024, junkChatId: '99' }),
      { allowPrivateRemote: true },
    );
    expect(summary.mailboxes[0]?.folders[0]?.forwarded).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('huge');
    expect(sent[0]?.text).toContain('MAX_EMAIL_BYTES');
  });

  it('records failures in KV status without throwing the whole poll', async () => {
    const config = makeConfig(server.port);
    config.mailboxes[0]!.port = 1;
    const summary = await pollAll(env(), config, { allowPrivateRemote: true });
    expect(summary.mailboxes[0]?.error).toBeTruthy();
    expect(summary.mailboxes[0]?.error).toMatch(/IMAP|connect|timed out/i);

    const status = await store().getStatus('test@example.com');
    expect(status?.lastError).toBeTruthy();
  });
});
