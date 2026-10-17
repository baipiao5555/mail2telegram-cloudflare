import net from 'node:net';

export interface FakeFolder {
  name: string;
  uidValidity: number;
  junk: boolean;
  messages: Map<number, Buffer>;
}

export interface FakeImapOptions {
  email?: string;
  password?: string;
  advertisePlain?: boolean;
}

function unquote(value: string): string {
  return value.slice(1, -1).replace(/\\(.)/g, '$1');
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** A deliberately small IMAP4rev1 server used to exercise the real client code. */
export class FakeImapServer {
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly folders = new Map<string, FakeFolder>();
  private readonly email: string;
  private readonly password: string;
  private readonly advertisePlain: boolean;
  port = 0;

  constructor(options: FakeImapOptions = {}) {
    this.email = options.email ?? 'test@example.com';
    this.password = options.password ?? 'secret';
    this.advertisePlain = options.advertisePlain ?? true;
    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  addFolder(name: string, uidValidity: number, junk = false): void {
    this.folders.set(name, { name, uidValidity, junk, messages: new Map() });
  }

  addMessage(folderName: string, uid: number, raw: string | Buffer): void {
    const folder = this.folders.get(folderName);
    if (!folder) {
      throw new Error(`unknown fake folder: ${folderName}`);
    }
    folder.messages.set(uid, Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8'));
  }

  setUidValidity(folderName: string, uidValidity: number): void {
    const folder = this.folders.get(folderName);
    if (!folder) {
      throw new Error(`unknown fake folder: ${folderName}`);
    }
    folder.uidValidity = uidValidity;
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve) => {
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to get fake IMAP port');
    }
    this.port = address.port;
    return this.port;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private handleConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.setNoDelay(true);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => {
      // Ignore client disconnects.
    });

    const capability = this.advertisePlain ? 'IMAP4rev1 AUTH=PLAIN' : 'IMAP4rev1';
    socket.write(`* OK [CAPABILITY ${capability}] fake IMAP ready\r\n`);

    let buffer = '';
    let authenticated = false;
    let awaitingAuthTag: string | null = null;
    let currentFolder: FakeFolder | null = null;

    const write = (text: string | Buffer): void => {
      if (!socket.destroyed) {
        socket.write(text);
      }
    };

    const ok = (tag: string, text: string): void => write(`${tag} OK ${text}\r\n`);
    const no = (tag: string, text: string): void => write(`${tag} NO ${text}\r\n`);
    const bad = (tag: string, text: string): void => write(`${tag} BAD ${text}\r\n`);

    const requireAuth = (tag: string): boolean => {
      if (!authenticated) {
        no(tag, 'Not authenticated');
        return false;
      }
      return true;
    };

    const sendFolderList = (tag: string): void => {
      for (const folder of this.folders.values()) {
        const flags = folder.junk ? '\\HasNoChildren \\Junk' : '\\HasNoChildren';
        write(`* LIST (${flags}) "/" ${quote(folder.name)}\r\n`);
      }
      ok(tag, 'LIST completed');
    };

    const selectFolder = (tag: string, rawName: string): void => {
      const name = unquote(rawName);
      const folder =
        Array.from(this.folders.values()).find(
          (candidate) =>
            candidate.name === name ||
            (candidate.name.toUpperCase() === 'INBOX' && name.toUpperCase() === 'INBOX'),
        ) ?? null;
      if (!folder) {
        no(tag, 'No such mailbox');
        return;
      }
      currentFolder = folder;
      const maxUid = Math.max(0, ...folder.messages.keys());
      write(`* ${folder.messages.size} EXISTS\r\n`);
      write(`* OK [UIDVALIDITY ${folder.uidValidity}] UIDVALIDITY\r\n`);
      write(`* OK [UIDNEXT ${maxUid + 1}] UIDNEXT\r\n`);
      write('* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)\r\n');
      ok(tag, '[READ-WRITE] SELECT completed');
    };

    const sendSearch = (tag: string, uids: number[]): void => {
      write(`* SEARCH${uids.length > 0 ? ` ${uids.join(' ')}` : ''}\r\n`);
      ok(tag, 'SEARCH completed');
    };

    const fetchMessage = (tag: string, uid: number, kind: 'size' | 'raw' | 'headers'): void => {
      if (!currentFolder) {
        bad(tag, 'No mailbox selected');
        return;
      }
      const raw = currentFolder.messages.get(uid);
      if (!raw) {
        no(tag, 'No such message');
        return;
      }
      if (kind === 'size') {
        write(`* 1 FETCH (UID ${uid} RFC822.SIZE ${raw.length})\r\n`);
        ok(tag, 'FETCH completed');
        return;
      }

      let payload = raw;
      if (kind === 'headers') {
        const text = raw.toString('latin1');
        const separator = text.search(/\r?\n\r?\n/);
        const headerBlock = separator >= 0 ? text.slice(0, separator) : text;
        const wanted = new Set([
          'from',
          'subject',
          'date',
          'message-id',
          'delivered-to',
          'x-original-to',
          'to',
        ]);
        const lines = headerBlock.split(/\r?\n/);
        const selected: string[] = [];
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index]!;
          if (/^[ \t]/.test(line)) {
            if (selected.length > 0) {
              selected[selected.length - 1] = `${selected[selected.length - 1]} ${line.trim()}`;
            }
            continue;
          }
          const key = line.split(':', 1)[0]?.toLowerCase() ?? '';
          if (wanted.has(key)) {
            selected.push(line);
          }
        }
        payload = Buffer.from(`${selected.join('\r\n')}\r\n\r\n`, 'latin1');
      }

      write(`* 1 FETCH (UID ${uid} BODY[] {${payload.length}}\r\n`);
      write(payload);
      write(')\r\n');
      ok(tag, 'FETCH completed');
    };

    const handleCommand = (tag: string, command: string): void => {
      const upper = command.toUpperCase();

      if (upper === 'CAPABILITY') {
        write(`* CAPABILITY ${capability}\r\n`);
        ok(tag, 'CAPABILITY completed');
        return;
      }

      if (upper === 'AUTHENTICATE PLAIN') {
        if (!this.advertisePlain) {
          no(tag, 'AUTHENTICATE not supported');
          return;
        }
        awaitingAuthTag = tag;
        write('+ \r\n');
        return;
      }

      if (upper.startsWith('LOGIN ')) {
        const match = command.match(/^LOGIN ("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/i);
        if (!match) {
          bad(tag, 'Invalid LOGIN arguments');
          return;
        }
        if (unquote(match[1]!) === this.email && unquote(match[2]!) === this.password) {
          authenticated = true;
          ok(tag, 'LOGIN completed');
        } else {
          no(tag, 'Invalid credentials');
        }
        return;
      }

      if (upper === 'LOGOUT') {
        write('* BYE logging out\r\n');
        ok(tag, 'LOGOUT completed');
        socket.end();
        return;
      }

      if (!requireAuth(tag)) {
        return;
      }

      if (upper === 'LIST "" "*"') {
        sendFolderList(tag);
        return;
      }

      if (upper.startsWith('SELECT ')) {
        selectFolder(tag, command.slice('SELECT '.length).trim());
        return;
      }

      if (upper === 'UID SEARCH ALL') {
        if (!currentFolder) {
          bad(tag, 'No mailbox selected');
          return;
        }
        sendSearch(tag, Array.from(currentFolder.messages.keys()).sort((a, b) => a - b));
        return;
      }

      const searchMatch = command.match(/^UID SEARCH UID (\d+):\*$/i);
      if (searchMatch) {
        if (!currentFolder) {
          bad(tag, 'No mailbox selected');
          return;
        }
        const start = Number(searchMatch[1]);
        sendSearch(
          tag,
          Array.from(currentFolder.messages.keys())
            .filter((uid) => uid >= start)
            .sort((a, b) => a - b),
        );
        return;
      }

      const fetchSizeMatch = command.match(/^UID FETCH (\d+) \(RFC822\.SIZE\)$/i);
      if (fetchSizeMatch) {
        fetchMessage(tag, Number(fetchSizeMatch[1]), 'size');
        return;
      }

      const fetchRawMatch = command.match(/^UID FETCH (\d+) \(BODY\.PEEK\[\]\)$/i);
      if (fetchRawMatch) {
        fetchMessage(tag, Number(fetchRawMatch[1]), 'raw');
        return;
      }

      const fetchHeadersMatch = command.match(/^UID FETCH (\d+) \(BODY\.PEEK\[HEADER\.FIELDS/i);
      if (fetchHeadersMatch) {
        fetchMessage(tag, Number(fetchHeadersMatch[1]), 'headers');
        return;
      }

      bad(tag, `Unknown command: ${command}`);
    };

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      while (true) {
        const index = buffer.indexOf('\r\n');
        if (index < 0) {
          break;
        }
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (awaitingAuthTag) {
          const tag = awaitingAuthTag;
          awaitingAuthTag = null;
          let decoded = '';
          try {
            decoded = Buffer.from(line, 'base64').toString('utf8');
          } catch {
            no(tag, 'Invalid base64');
            continue;
          }
          const parts = decoded.split('\u0000');
          if (parts.length >= 3 && parts[1] === this.email && parts[2] === this.password) {
            authenticated = true;
            ok(tag, 'AUTHENTICATE completed');
          } else {
            no(tag, 'Invalid credentials');
          }
          continue;
        }

        if (!line) {
          continue;
        }
        const match = line.match(/^(\S+)\s+(.+)$/);
        if (!match) {
          continue;
        }
        handleCommand(match[1]!, match[2]!);
      }
    });
  }
}
