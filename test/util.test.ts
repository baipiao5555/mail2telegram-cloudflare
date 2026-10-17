import { describe, expect, it } from 'vitest';
import {
  chunkText,
  formatDateTime,
  htmlToText,
  telegramHtmlToPlain,
  timingSafeEqualString,
} from '../src/util';

describe('htmlToText', () => {
  it('removes scripts, styles, and markup', () => {
    const html = `
      <html><head><title>ignore</title><style>.x{color:red}</style></head>
      <body>
        <script>alert('x')</script>
        <h1>Hello</h1>
        <p>World &amp; friends&nbsp;here</p>
        <ul><li>one</li><li>two</li></ul>
        <img src="x" alt="logo">
      </body></html>
    `;
    const text = htmlToText(html);
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).toContain('Hello');
    expect(text).toContain('World & friends here');
    expect(text).toContain('• one');
    expect(text).toContain('logo');
  });

  it('decodes numeric entities', () => {
    expect(htmlToText('<p>&#20320;&#22909; &#x4e16;&#x754c;</p>')).toBe('你好 世界');
  });
});

describe('telegramHtmlToPlain', () => {
  it('strips tags and decodes escaped content', () => {
    expect(telegramHtmlToPlain('<b>主题:</b> a &lt; b &amp; c')).toBe('主题: a < b & c');
  });
});

describe('chunkText', () => {
  it('returns a single chunk when short', () => {
    expect(chunkText('hello', 100)).toEqual(['hello']);
  });

  it('splits long text without exceeding the limit', () => {
    const text = Array.from({ length: 200 }, (_, index) => `line ${index}`).join('\n');
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
    expect(chunks.join('\n')).toBe(text);
  });

  it('does not split surrogate pairs', () => {
    const text = '😀'.repeat(100);
    const chunks = chunkText(text, 11);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(11);
      expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/);
    }
    expect(chunks.join('')).toBe(text);
  });
});

describe('formatDateTime', () => {
  it('formats in the configured timezone', () => {
    expect(formatDateTime('2026-10-17T00:00:00Z', 'Asia/Shanghai')).toBe('2026-10-17 08:00:00');
    expect(formatDateTime('2026-10-17T00:00:00Z', 'UTC')).toBe('2026-10-17 00:00:00');
  });

  it('falls back to the raw value when the date is invalid', () => {
    expect(formatDateTime('not a date', 'UTC')).toBe('not a date');
  });
});

describe('timingSafeEqualString', () => {
  it('compares strings of different lengths safely', () => {
    expect(timingSafeEqualString('secret', 'secret')).toBe(true);
    expect(timingSafeEqualString('secret', 'secreu')).toBe(false);
    expect(timingSafeEqualString('secret', 'secret-longer')).toBe(false);
    expect(timingSafeEqualString('', '')).toBe(true);
  });
});
