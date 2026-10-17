import { describe, expect, it } from 'vitest';
import { renderTelegramHtml } from '../src/html';

describe('renderTelegramHtml', () => {
  it('renders safe Telegram formatting and links', () => {
    const result = renderTelegramHtml(
      '<p>Hello <strong>world</strong> <a href="https://example.com/a?b=1&c=2">link</a></p>' +
        '<ul><li>one</li><li>two</li></ul>',
    );
    expect(result.html).toContain('<b>world</b>');
    expect(result.html).toContain('<a href="https://example.com/a?b=1&amp;c=2">link</a>');
    expect(result.html).toContain('• one');
    expect(result.html).toContain('• two');
    expect(result.text).toContain('Hello world link');
    expect(result.text).toContain('one');
  });

  it('removes scripts, styles, and unsafe links', () => {
    const result = renderTelegramHtml(
      '<script>alert(1)</script><style>.x{color:red}</style>' +
        '<p>safe <a href="javascript:alert(1)">bad</a></p>',
    );
    expect(result.html).not.toContain('alert');
    expect(result.html).not.toContain('color:red');
    expect(result.html).not.toContain('javascript:');
    expect(result.text).toBe('safe bad');
  });

  it('decodes entities and escapes text for Telegram HTML', () => {
    const result = renderTelegramHtml('<p>&lt;tag&gt; &amp; &nbsp; ok</p>');
    expect(result.html).toBe('&lt;tag&gt; &amp; ok');
    expect(result.text).toBe('<tag> & ok');
  });

  it('preserves preformatted whitespace and escapes it', () => {
    const result = renderTelegramHtml('<pre>  a &lt; b\n    c</pre>');
    expect(result.html).toBe('<pre>  a &lt; b\n    c</pre>');
    expect(result.text).toBe('a < b\nc');
  });

  it('truncates long visible text', () => {
    const result = renderTelegramHtml('<p>' + 'x'.repeat(100) + '</p>', 10);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('xxxxxxxxxx...');
    expect(result.html).toContain('xxxxxxxxxx...');
  });

  it('falls back to plain text for empty html', () => {
    const result = renderTelegramHtml('');
    expect(result.html).toBe('');
    expect(result.text).toBe('');
  });
});
