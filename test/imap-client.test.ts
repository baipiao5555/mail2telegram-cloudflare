import { afterEach, describe, expect, it } from 'vitest';
import { ImapClient } from '../src/imap/client';
import { parseRawEmail } from '../src/mail';
import { FakeImapServer } from './helpers/fake-imap';

let server: FakeImapServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

function makeServer(advertisePlain = true): FakeImapServer {
  const instance = new FakeImapServer({ advertisePlain });
  instance.addFolder('INBOX', 1000);
  instance.addFolder('Junk', 2000, true);
  instance.addMessage(
    'INBOX',
    1,
    [
      'From: Alice <alice@example.com>',
      'To: test@example.com',
      'Subject: hello',
      'Message-ID: <one@example.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'first message',
    ].join('\r\n'),
  );
  return instance;
}

describe('ImapClient', () => {
  it('authenticates, lists, selects, searches, and fetches', async () => {
    server = makeServer();
    const port = await server.start();
    const client = new ImapClient({
      host: '127.0.0.1',
      port,
      allowPrivateRemote: true,
      timeoutMs: 5000,
    });

    try {
      await client.connect();
      await client.login('test@example.com', 'secret');
      expect(Array.from(client.capabilities)).toContain('AUTH=PLAIN');

      const folders = await client.list();
      expect(folders.map((folder) => folder.name)).toEqual(['INBOX', 'Junk']);

      const selection = await client.select('INBOX');
      expect(selection.uidValidity).toBe(1000);
      expect(selection.exists).toBe(1);

      expect(await client.uidSearchAll()).toEqual([1]);
      expect(await client.uidSearchSince(0)).toEqual([1]);
      expect(await client.uidSearchSince(1)).toEqual([]);
      expect(await client.fetchSize(1)).toBeGreaterThan(0);

      const raw = await client.fetchRaw(1);
      const mail = await parseRawEmail(raw);
      expect(mail.subject).toBe('hello');
      expect(mail.content).toBe('first message');

      const headers = await client.fetchHeaders(1);
      expect(new TextDecoder().decode(headers)).toContain('Subject: hello');
    } finally {
      await client.logout();
    }
  });

  it('falls back to LOGIN when AUTH=PLAIN is not advertised', async () => {
    server = makeServer(false);
    const port = await server.start();
    const client = new ImapClient({
      host: '127.0.0.1',
      port,
      allowPrivateRemote: true,
      timeoutMs: 5000,
    });

    try {
      await client.connect();
      expect(Array.from(client.capabilities)).not.toContain('AUTH=PLAIN');
      await client.login('test@example.com', 'secret');
      expect((await client.list()).length).toBeGreaterThan(0);
    } finally {
      await client.logout();
    }
  });

  it('rejects a wrong password', async () => {
    server = makeServer();
    const port = await server.start();
    const client = new ImapClient({
      host: '127.0.0.1',
      port,
      allowPrivateRemote: true,
      timeoutMs: 5000,
    });

    try {
      await client.connect();
      await expect(client.login('test@example.com', 'wrong')).rejects.toThrow(/LOGIN failed/);
    } finally {
      await client.logout();
    }
  });

  it('refuses private hosts unless the test escape hatch is enabled', async () => {
    expect(
      () =>
        new ImapClient({
          host: '127.0.0.1',
          port: 993,
        }),
    ).toThrow(/private or reserved/);
  });
});
