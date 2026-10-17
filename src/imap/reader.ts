export type ImapStatus = 'OK' | 'NO' | 'BAD' | 'PREAUTH' | 'BYE';

export interface ImapResponse {
  tag: string;
  status: ImapStatus;
  lines: string[];
  literals: Uint8Array[];
}

export class ImapProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImapProtocolError';
  }
}

const MAX_LINE_BYTES = 1024 * 1024;

/** Buffered, literal-aware reader over an IMAP byte stream. */
export class ByteReader {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private readonly decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false });

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private async fill(): Promise<void> {
    const { done, value } = await this.reader.read();
    if (done || !value) {
      throw new ImapProtocolError('IMAP connection closed unexpectedly');
    }
    if (this.buffer.length === 0) {
      this.buffer = value;
    } else {
      const merged = new Uint8Array(this.buffer.length + value.length);
      merged.set(this.buffer, 0);
      merged.set(value, this.buffer.length);
      this.buffer = merged;
    }
  }

  async readLine(): Promise<string> {
    let searchFrom = 0;
    while (true) {
      const newline = this.buffer.indexOf(0x0a, searchFrom);
      if (newline >= 0) {
        let end = newline;
        if (end > 0 && this.buffer[end - 1] === 0x0d) {
          end -= 1;
        }
        const line = this.decoder.decode(this.buffer.subarray(0, end));
        this.buffer = this.buffer.subarray(newline + 1);
        return line;
      }
      if (this.buffer.length > MAX_LINE_BYTES) {
        throw new ImapProtocolError('IMAP response line is too long');
      }
      searchFrom = this.buffer.length;
      await this.fill();
    }
  }

  async readExact(length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new ImapProtocolError('invalid IMAP literal length');
    }
    while (this.buffer.length < length) {
      await this.fill();
    }
    const result = this.buffer.slice(0, length);
    this.buffer = this.buffer.subarray(length);
    return result;
  }

  async cancel(): Promise<void> {
    await this.reader.cancel();
  }
}

export interface ReadResponseOptions {
  maxLiteralBytes?: number;
}

/**
 * Reads one complete tagged response. Server literals are read in full and returned
 * separately; their marker lines remain in `lines` for callers that need positions.
 */
export async function readResponse(
  reader: ByteReader,
  tag: string,
  options: ReadResponseOptions = {},
): Promise<ImapResponse> {
  const maxLiteralBytes = options.maxLiteralBytes ?? 32 * 1024 * 1024;
  const lines: string[] = [];
  const literals: Uint8Array[] = [];

  while (true) {
    const line = await reader.readLine();
    const literal = line.match(/\{(\d+)\+?\}$/);
    if (literal) {
      const length = Number.parseInt(literal[1]!, 10);
      if (!Number.isSafeInteger(length) || length < 0 || length > maxLiteralBytes) {
        throw new ImapProtocolError(`IMAP literal is too large: ${literal[1]}`);
      }
      lines.push(line);
      literals.push(await reader.readExact(length));
      continue;
    }

    lines.push(line);

    if (line.startsWith(`${tag} `)) {
      const statusText = line.slice(tag.length + 1).split(/\s+/, 1)[0]?.toUpperCase() ?? '';
      const status: ImapStatus =
        statusText === 'OK' || statusText === 'NO' || statusText === 'BAD' || statusText === 'PREAUTH' || statusText === 'BYE'
          ? statusText
          : 'BAD';
      return { tag, status, lines, literals };
    }

    if (line.startsWith('+')) {
      throw new ImapProtocolError('unexpected IMAP continuation response');
    }
  }
}
