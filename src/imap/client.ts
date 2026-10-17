import { connect } from 'cloudflare:sockets';
import { assertSafeHost, isPrivateAddress } from '../security';
import { bytesToBase64 } from '../util';
import {
  parseExistsCount,
  parseFetchSize,
  parseListResponse,
  parseSearchResponse,
  parseUidValidity,
  isAscii,
  encodeMailboxName,
  quoteImapString,
  type FolderInfo,
} from './parser';
import { ByteReader, ImapProtocolError, readResponse, type ImapResponse } from './reader';

export interface ImapClientOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  maxLiteralBytes?: number;
  deadline?: number;
  /** Test-only escape hatch. Production configuration is validated before this client is built. */
  allowPrivateRemote?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function isQuotable(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value) && !value.includes('"') && !value.includes('\\');
}

export class ImapClient {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly maxLiteralBytes: number;
  private readonly deadline: number;
  private readonly allowPrivateRemote: boolean;
  private socket: Socket | null = null;
  private reader: ByteReader | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private tagCounter = 0;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private idleTag: string | null = null;

  readonly capabilities = new Set<string>();
  uidValidity = 0;
  currentFolder = '';

  constructor(options: ImapClientOptions) {
    this.host = options.allowPrivateRemote ? options.host : assertSafeHost(options.host);
    this.port = options.port;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxLiteralBytes = options.maxLiteralBytes ?? 32 * 1024 * 1024;
    this.deadline = options.deadline ?? Number.POSITIVE_INFINITY;
    this.allowPrivateRemote = options.allowPrivateRemote ?? false;
  }

  private nextTag(): string {
    this.tagCounter += 1;
    return `A${String(this.tagCounter).padStart(4, '0')}`;
  }

  private remainingTimeout(): number {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('IMAP operation exceeded the account time budget');
    }
    return Math.max(1, Math.min(this.timeoutMs, remaining));
  }

  private assertAlive(): void {
    if (this.closed) {
      throw new Error('IMAP connection is closed');
    }
  }

  private async withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    const timeoutMs = this.remainingTimeout();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void this.close();
        reject(new Error(`IMAP ${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private async write(text: string): Promise<void> {
    await this.writeBytes(new TextEncoder().encode(text));
  }

  private async writeBytes(bytes: Uint8Array): Promise<void> {
    this.assertAlive();
    if (!this.writer) {
      throw new Error('IMAP writer is not ready');
    }
    await this.withTimeout(this.writer.write(bytes), 'write');
  }

  private async writeLine(line: string): Promise<void> {
    await this.write(`${line}\r\n`);
  }

  private async readLine(): Promise<string> {
    if (!this.reader) {
      throw new Error('IMAP reader is not ready');
    }
    return this.withTimeout(this.reader.readLine(), 'read');
  }

  private async readResponse(tag: string): Promise<ImapResponse> {
    if (!this.reader) {
      throw new Error('IMAP reader is not ready');
    }
    return this.withTimeout(
      readResponse(this.reader, tag, { maxLiteralBytes: this.maxLiteralBytes }),
      'response',
    );
  }

  private async command(command: string): Promise<ImapResponse> {
    this.assertAlive();
    const tag = this.nextTag();
    await this.writeLine(`${tag} ${command}`);
    return this.readResponse(tag);
  }

  private assertOk(response: ImapResponse, action: string): void {
    if (response.status !== 'OK' && response.status !== 'PREAUTH') {
      const detail = response.lines[response.lines.length - 1] ?? response.status;
      throw new ImapProtocolError(`${action} failed: ${detail}`);
    }
  }

  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }
    const socket = connect(
      { hostname: this.host, port: this.port },
      { secureTransport: 'on', allowHalfOpen: false },
    );
    this.socket = socket;

    const info = await this.withTimeout(socket.opened, 'connect');
    if (!this.allowPrivateRemote && info.remoteAddress && isPrivateAddress(info.remoteAddress)) {
      await this.close();
      throw new Error('IMAP server resolved to a private or reserved address');
    }

    this.reader = new ByteReader(socket.readable.getReader());
    this.writer = socket.writable.getWriter();

    const greeting = await this.readLine();
    if (!greeting.startsWith('* OK') && !greeting.startsWith('* PREAUTH')) {
      throw new ImapProtocolError(`unexpected IMAP greeting: ${greeting}`);
    }

    const greetingCaps = greeting.match(/\[CAPABILITY\s+([^\]]+)\]/i);
    if (greetingCaps) {
      for (const capability of greetingCaps[1]!.split(/\s+/)) {
        this.capabilities.add(capability.toUpperCase());
      }
    }

    try {
      const capabilityResponse = await this.command('CAPABILITY');
      for (const line of capabilityResponse.lines) {
        if (line.startsWith('* CAPABILITY ')) {
          for (const capability of line.slice('* CAPABILITY '.length).split(/\s+/)) {
            this.capabilities.add(capability.toUpperCase());
          }
        }
      }
    } catch {
      // Some servers reject an explicit CAPABILITY command; LOGIN still works.
    }
  }

  async login(email: string, password: string): Promise<void> {
    this.assertAlive();
    if (this.capabilities.has('AUTH=PLAIN')) {
      const tag = this.nextTag();
      await this.writeLine(`${tag} AUTHENTICATE PLAIN`);
      const continuation = await this.readLine();
      if (!continuation.startsWith('+')) {
        throw new ImapProtocolError(`AUTHENTICATE PLAIN was rejected: ${continuation}`);
      }
      const payload = bytesToBase64(new TextEncoder().encode(`\0${email}\0${password}`));
      await this.writeLine(payload);
      const response = await this.readResponse(tag);
      this.assertOk(response, 'LOGIN');
      return;
    }

    const tag = this.nextTag();
    await this.write(`${tag} LOGIN `);
    const args = [email, password];
    for (let index = 0; index < args.length; index++) {
      const value = args[index]!;
      if (isAscii(value) && isQuotable(value)) {
        await this.write(quoteImapString(value));
      } else {
        const bytes = new TextEncoder().encode(value);
        await this.write(`{${bytes.length}}\r\n`);
        const continuation = await this.readLine();
        if (!continuation.startsWith('+')) {
          throw new ImapProtocolError(`LOGIN literal was rejected: ${continuation}`);
        }
        await this.writeBytes(bytes);
      }
      await this.write(index === args.length - 1 ? '\r\n' : ' ');
    }
    const response = await this.readResponse(tag);
    this.assertOk(response, 'LOGIN');
  }

  async list(): Promise<FolderInfo[]> {
    const response = await this.command('LIST "" "*"');
    this.assertOk(response, 'LIST');
    return parseListResponse(response.lines, response.literals);
  }

  async select(folder: string): Promise<{ uidValidity: number; exists: number | null }> {
    const mailbox = encodeMailboxName(folder);
    const response = await this.command(`SELECT ${quoteImapString(mailbox)}`);
    this.assertOk(response, `SELECT ${folder}`);
    this.currentFolder = folder;
    this.uidValidity = parseUidValidity(response.lines) ?? 0;
    return { uidValidity: this.uidValidity, exists: parseExistsCount(response.lines) };
  }

  async uidSearchAll(): Promise<number[]> {
    const response = await this.command('UID SEARCH ALL');
    this.assertOk(response, 'UID SEARCH ALL');
    return parseSearchResponse(response.lines);
  }

  async uidSearchSince(sinceUid: number): Promise<number[]> {
    const start = Math.max(1, sinceUid + 1);
    const response = await this.command(`UID SEARCH UID ${start}:*`);
    this.assertOk(response, 'UID SEARCH');
    return parseSearchResponse(response.lines).filter((uid) => uid > sinceUid);
  }

  async fetchSize(uid: number): Promise<number | null> {
    const response = await this.command(`UID FETCH ${uid} (RFC822.SIZE)`);
    this.assertOk(response, `UID FETCH ${uid} size`);
    return parseFetchSize(response.lines);
  }

  async fetchRaw(uid: number): Promise<Uint8Array> {
    const response = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`);
    this.assertOk(response, `UID FETCH ${uid}`);
    const literal = response.literals.find((item) => item.length > 0);
    if (!literal) {
      throw new ImapProtocolError(`message ${uid} returned no body`);
    }
    return literal;
  }

  async fetchHeaders(uid: number): Promise<Uint8Array> {
    const response = await this.command(
      `UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID DELIVERED-TO X-ORIGINAL-TO TO)])`,
    );
    this.assertOk(response, `UID FETCH ${uid} headers`);
    return response.literals[0] ?? new Uint8Array(0);
  }

  async startIdle(): Promise<void> {
    this.assertAlive();
    if (!this.capabilities.has('IDLE')) {
      throw new Error('IMAP server does not advertise IDLE');
    }
    if (this.idleTag) {
      throw new Error('IDLE is already active');
    }
    const tag = this.nextTag();
    await this.writeLine(`${tag} IDLE`);
    const continuation = await this.readLine();
    if (!continuation.startsWith('+')) {
      throw new ImapProtocolError(`IDLE was rejected: ${continuation}`);
    }
    this.idleTag = tag;
  }

  private async finishIdle(tag: string, pendingLine?: Promise<string>): Promise<void> {
    await this.writeLine('DONE');
    let line = pendingLine ? await pendingLine : await this.readLine();
    while (!line.startsWith(`${tag} `)) {
      if (line.startsWith('* BYE')) {
        this.idleTag = null;
        throw new ImapProtocolError(`server closed during IDLE: ${line}`);
      }
      line = await this.readLine();
    }
    this.idleTag = null;
  }

  /**
   * Waits for an EXISTS/RECENT notification. When it arrives, IDLE is ended and
   * "mail" is returned. On timeout, DONE is sent and "timeout" is returned.
   */
  async waitForIdleEvent(timeoutMs: number): Promise<'mail' | 'timeout'> {
    this.assertAlive();
    if (!this.idleTag || !this.reader) {
      throw new Error('IDLE is not active');
    }
    const tag = this.idleTag;
    const deadline = Date.now() + Math.max(1, timeoutMs);

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        await this.finishIdle(tag);
        return 'timeout';
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const linePromise = this.reader.readLine();
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), remaining);
      });
      const result = await Promise.race([linePromise, timeout]);
      if (timer !== undefined) {
        clearTimeout(timer);
      }

      if (result === 'timeout') {
        await this.finishIdle(tag, linePromise);
        return 'timeout';
      }

      const line = result;
      if (line.startsWith(`${tag} `)) {
        this.idleTag = null;
        throw new ImapProtocolError(`IDLE ended unexpectedly: ${line}`);
      }
      if (line.startsWith('* BYE')) {
        this.idleTag = null;
        throw new ImapProtocolError(`server closed during IDLE: ${line}`);
      }
      if (/^\*\s+\d+\s+(EXISTS|RECENT)$/i.test(line)) {
        await this.finishIdle(tag);
        return 'mail';
      }
      // Ignore untagged keep-alive, FLAGS, EXPUNGE, and FETCH lines.
    }
  }

  async logout(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.idleTag) {
      try {
        await this.finishIdle(this.idleTag);
      } catch {
        // Closing the socket below is sufficient.
      }
    }
    try {
      await this.command('LOGOUT');
    } catch {
      // The server closes the socket after BYE; a missing tagged OK is expected.
    } finally {
      await this.close();
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closed = true;
    this.idleTag = null;
    this.closePromise = (async () => {
      try {
        await this.reader?.cancel();
      } catch {
        // Ignore cancellation errors.
      }
      try {
        await this.socket?.close();
      } catch {
        // Ignore close errors.
      }
      this.reader = null;
      this.writer = null;
      this.socket = null;
    })();
    return this.closePromise;
  }
}
