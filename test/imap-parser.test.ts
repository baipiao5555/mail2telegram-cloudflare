import { describe, expect, it } from 'vitest';
import {
  encodeMailboxName,
  isJunkFolder,
  isSelectableFolder,
  parseExistsCount,
  parseFetchSize,
  parseListResponse,
  parseSearchResponse,
  parseUidValidity,
  quoteImapString,
} from '../src/imap/parser';

describe('parseListResponse', () => {
  it('parses flags, delimiter, and quoted names', () => {
    const folders = parseListResponse(
      [
        '* LIST (\\HasNoChildren) "/" "INBOX"',
        '* LIST (\\HasNoChildren \\Junk) "/" "[Gmail]/Spam"',
        '* LIST (\\Noselect) "/" "Parent"',
      ],
      [],
    );
    expect(folders).toEqual([
      { name: 'INBOX', flags: ['\\HasNoChildren'], delimiter: '/' },
      { name: '[Gmail]/Spam', flags: ['\\HasNoChildren', '\\Junk'], delimiter: '/' },
      { name: 'Parent', flags: ['\\Noselect'], delimiter: '/' },
    ]);
    expect(isJunkFolder(folders[1]!)).toBe(true);
    expect(isSelectableFolder(folders[2]!)).toBe(false);
  });

  it('handles NIL delimiter and escaped quotes', () => {
    const folders = parseListResponse(['* LIST (\\HasNoChildren) NIL "My \\"Folder\\""'], []);
    expect(folders).toEqual([
      { name: 'My "Folder"', flags: ['\\HasNoChildren'], delimiter: null },
    ]);
  });

  it('handles literal mailbox names', () => {
    const literal = new TextEncoder().encode('Junk');
    const folders = parseListResponse(['* LIST (\\Junk) "/" {4}'], [literal]);
    expect(folders[0]?.name).toBe('Junk');
  });
});

describe('search and status parsing', () => {
  it('parses search results, deduplicating and sorting', () => {
    expect(parseSearchResponse(['* SEARCH 5 2 5 9', 'A1 OK done'])).toEqual([2, 5, 9]);
    expect(parseSearchResponse(['* SEARCH'])).toEqual([]);
  });

  it('parses UIDVALIDITY, EXISTS, and size', () => {
    expect(parseUidValidity(['* OK [UIDVALIDITY 12345] UIDVALIDITY'])).toBe(12345);
    expect(parseUidValidity(['* OK no validity'])).toBeNull();
    expect(parseExistsCount(['* 12 EXISTS'])).toBe(12);
    expect(parseFetchSize(['* 1 FETCH (UID 3 RFC822.SIZE 4096)'])).toBe(4096);
  });
});

describe('IMAP strings', () => {
  it('quotes and escapes strings', () => {
    expect(quoteImapString('INBOX')).toBe('"INBOX"');
    expect(quoteImapString('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(() => quoteImapString('a\r\nb')).toThrow();
  });

  it('encodes non-ASCII mailbox names with modified UTF-7', () => {
    expect(encodeMailboxName('INBOX')).toBe('INBOX');
    expect(encodeMailboxName('A&B')).toBe('A&-B');
    expect(encodeMailboxName('垃圾邮件')).toBe('&V4NXPpCuTvY-');
  });
});
