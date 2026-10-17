import { describe, expect, it } from 'vitest';
import { ByteReader, readResponse } from '../src/imap/reader';

function readerFromChunks(chunks: string[]): ByteReader {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new ByteReader(stream.getReader());
}

describe('ByteReader / readResponse', () => {
  it('reads a tagged response split across arbitrary chunks', async () => {
    const reader = readerFromChunks([
      '* 2 EXIS',
      'TS\r\n* OK [UIDVALIDITY 7',
      '7] ok\r\nA0001 O',
      'K SELECT completed\r\n',
    ]);
    const response = await readResponse(reader, 'A0001');
    expect(response.status).toBe('OK');
    expect(response.lines).toContain('* 2 EXISTS');
    expect(response.lines).toContain('* OK [UIDVALIDITY 77] ok');
    expect(response.literals).toEqual([]);
  });

  it('reads a literal split across chunks and continues after it', async () => {
    const literal = 'hello world';
    const reader = readerFromChunks([
      `* 1 FETCH (UID 3 BODY[] {${literal.length}}\r\nhel`,
      'lo wo',
      'rld)\r\nA0002 OK FETCH completed\r\n',
    ]);
    const response = await readResponse(reader, 'A0002');
    expect(response.status).toBe('OK');
    expect(new TextDecoder().decode(response.literals[0])).toBe(literal);
    expect(response.lines[response.lines.length - 1]).toBe('A0002 OK FETCH completed');
  });

  it('throws when the connection ends before a tagged response', async () => {
    const reader = readerFromChunks(['* OK hello\r\n']);
    await expect(readResponse(reader, 'A0001')).rejects.toThrow(/closed/);
  });

  it('rejects oversized literals', async () => {
    const reader = readerFromChunks(['* 1 FETCH (BODY[] {100}\r\n']);
    await expect(readResponse(reader, 'A0001', { maxLiteralBytes: 10 })).rejects.toThrow(
      /too large/,
    );
  });
});
