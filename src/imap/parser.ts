import { bytesToBase64 } from '../util';

export interface FolderInfo {
  name: string;
  flags: string[];
  delimiter: string | null;
}

interface ParsedNString {
  value: string | null;
  consumed: number;
}

function parseNString(input: string): ParsedNString | null {
  if (input.startsWith('NIL')) {
    return { value: null, consumed: 3 };
  }
  if (input.startsWith('"')) {
    let value = '';
    let index = 1;
    while (index < input.length) {
      const char = input[index]!;
      if (char === '\\') {
        const next = input[index + 1];
        if (next === undefined) {
          return null;
        }
        value += next;
        index += 2;
        continue;
      }
      if (char === '"') {
        return { value, consumed: index + 1 };
      }
      value += char;
      index += 1;
    }
    return null;
  }
  const atom = input.match(/^[^\s()]+/);
  if (!atom) {
    return null;
  }
  return { value: atom[0], consumed: atom[0].length };
}

function parseListLine(line: string, literal: Uint8Array | undefined): FolderInfo | null {
  if (!line.startsWith('* LIST ') && !line.startsWith('* LSUB ')) {
    return null;
  }
  const prefix = line.startsWith('* LIST ') ? '* LIST ' : '* LSUB ';
  let rest = line.slice(prefix.length).trimStart();

  if (!rest.startsWith('(')) {
    return null;
  }
  const flagsEnd = rest.indexOf(')');
  if (flagsEnd < 0) {
    return null;
  }
  const flags = rest
    .slice(1, flagsEnd)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  rest = rest.slice(flagsEnd + 1).trimStart();

  const delimiter = parseNString(rest);
  if (!delimiter) {
    return null;
  }
  rest = rest.slice(delimiter.consumed).trimStart();

  let name: string | null = null;
  if (/^\{\d+\+?\}$/.test(rest)) {
    name = literal ? new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(literal) : null;
  } else {
    const parsed = parseNString(rest);
    name = parsed?.value ?? null;
  }
  if (!name) {
    return null;
  }

  return { name, flags, delimiter: delimiter.value };
}

export function parseListResponse(lines: string[], literals: Uint8Array[]): FolderInfo[] {
  const folders: FolderInfo[] = [];
  let literalIndex = 0;

  for (const line of lines) {
    const literal = /\{\d+\+?\}$/.test(line) ? literals[literalIndex++] : undefined;
    const folder = parseListLine(line, literal);
    if (folder) {
      folders.push(folder);
    }
  }

  return folders;
}

export function parseSearchResponse(lines: string[]): number[] {
  const uids = new Set<number>();
  for (const line of lines) {
    if (!line.startsWith('* SEARCH')) {
      continue;
    }
    for (const token of line.slice('* SEARCH'.length).trim().split(/\s+/)) {
      if (/^\d+$/.test(token)) {
        const uid = Number.parseInt(token, 10);
        if (uid > 0) {
          uids.add(uid);
        }
      }
    }
  }
  return Array.from(uids).sort((a, b) => a - b);
}

export function parseUidValidity(lines: string[]): number | null {
  for (const line of lines) {
    const match = line.match(/\[UIDVALIDITY\s+(\d+)\]/i);
    if (match) {
      return Number.parseInt(match[1]!, 10);
    }
  }
  return null;
}

export function parseExistsCount(lines: string[]): number | null {
  for (const line of lines) {
    const match = line.match(/^\*\s+(\d+)\s+EXISTS$/i);
    if (match) {
      return Number.parseInt(match[1]!, 10);
    }
  }
  return null;
}

export function parseFetchSize(lines: string[]): number | null {
  for (const line of lines) {
    const match = line.match(/RFC822\.SIZE\s+(\d+)/i);
    if (match) {
      return Number.parseInt(match[1]!, 10);
    }
  }
  return null;
}

export function quoteImapString(value: string): string {
  if (/[\r\n\u0000]/.test(value)) {
    throw new Error('IMAP string must not contain newlines or NUL');
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function isAscii(value: string): boolean {
  return /^[\x00-\x7f]*$/.test(value);
}

/** RFC 3501 modified UTF-7, used for non-ASCII mailbox names. */
export function encodeMailboxName(name: string): string {
  if (/[\x00-\x1f\x7f]/.test(name)) {
    throw new Error('mailbox name contains control characters');
  }

  let output = '';
  let pending: number[] = [];

  const flush = (): void => {
    if (pending.length === 0) {
      return;
    }
    const bytes = new Uint8Array(pending.length * 2);
    pending.forEach((unit, index) => {
      bytes[index * 2] = unit >> 8;
      bytes[index * 2 + 1] = unit & 0xff;
    });
    output += `&${bytesToBase64(bytes).replace(/\//g, ',').replace(/=+$/, '')}-`;
    pending = [];
  };

  for (const char of name) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint >= 0x20 && codePoint <= 0x7e) {
      flush();
      output += char === '&' ? '&-' : char;
    } else if (codePoint > 0xffff) {
      const value = codePoint - 0x10000;
      pending.push(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
    } else {
      pending.push(codePoint);
    }
  }
  flush();
  return output;
}

const JUNK_NAME_PATTERN = /(^|[^a-z])(junk|spam|bulk)([^a-z]|$)|垃圾邮件|垃圾郵件/i;

export function isJunkFolder(folder: FolderInfo): boolean {
  if (folder.flags.some((flag) => /^\\(junk|spam)$/i.test(flag))) {
    return true;
  }
  const segments = folder.name.split(/[/\\]/);
  const last = segments[segments.length - 1] ?? folder.name;
  return JUNK_NAME_PATTERN.test(last);
}

export function isSelectableFolder(folder: FolderInfo): boolean {
  return !folder.flags.some((flag) => /^\\(noselect|nonexistent)$/i.test(flag));
}
