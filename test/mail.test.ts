import { describe, expect, it } from 'vitest';
import { detectForwarding, parseHeaderBlock, parseRawEmail } from '../src/mail';

function rawEmail(options: {
  subject?: string;
  from?: string;
  to?: string;
  deliveredTo?: string;
  messageId?: string;
  body?: string;
  bodyType?: string;
}): string {
  return [
    `From: ${options.from ?? 'Alice <alice@example.com>'}`,
    `To: ${options.to ?? 'test@example.com'}`,
    ...(options.deliveredTo ? [`Delivered-To: ${options.deliveredTo}`] : []),
    `Subject: ${options.subject ?? 'Hello'}`,
    'Date: Sat, 17 Oct 2026 10:00:00 +0800',
    `Message-ID: ${options.messageId ?? '<abc@example.com>'}`,
    'MIME-Version: 1.0',
    `Content-Type: ${options.bodyType ?? 'text/html'}; charset=utf-8`,
    '',
    options.body ?? '<html><body><p>Hello &amp; 世界</p><script>bad()</script></body></html>',
  ].join('\r\n');
}

describe('parseRawEmail', () => {
  it('decodes headers and prefers HTML content', async () => {
    const raw = rawEmail({
      subject: '=?UTF-8?B?5L2g5aW9?=',
      from: '=?UTF-8?B?546L5bCP5piO?= <ming@example.com>',
    });
    const mail = await parseRawEmail(new TextEncoder().encode(raw));
    expect(mail.subject).toBe('你好');
    expect(mail.from).toContain('ming@example.com');
    expect(mail.content).toBe('Hello & 世界');
    expect(mail.messageId).toBe('abc@example.com');
    expect(mail.deliveredTo).toBeUndefined();
  });

  it('falls back to plain text when HTML has no text', async () => {
    const raw = [
      'From: alice@example.com',
      'To: test@example.com',
      'Subject: plain',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<html><body><img src="x"></body></html>',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'plain body',
      '--b1--',
      '',
    ].join('\r\n');
    const mail = await parseRawEmail(new TextEncoder().encode(raw));
    expect(mail.content).toBe('plain body');
  });

  it('does not throw on malformed input', async () => {
    const mail = await parseRawEmail(new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x02]));
    expect(typeof mail.subject).toBe('string');
    expect(mail.content.length).toBeGreaterThan(0);
  });
});

describe('parseHeaderBlock', () => {
  it('extracts headers without a body', async () => {
    const headers = [
      'From: Alice <alice@example.com>',
      'To: forwarded@example.net',
      'Delivered-To: forwarded@example.net',
      'Subject: =?UTF-8?B?5rWL6K+V?=',
      'Date: Sat, 17 Oct 2026 10:00:00 +0800',
      'Message-ID: <header-only@example.com>',
      '',
      '',
    ].join('\r\n');
    const preview = await parseHeaderBlock(new TextEncoder().encode(headers));
    expect(preview.subject).toBe('测试');
    expect(preview.from).toContain('alice@example.com');
    expect(preview.deliveredTo).toBe('forwarded@example.net');
    expect(preview.messageId).toBe('header-only@example.com');
  });
});

describe('detectForwarding', () => {
  it('shows the account address for direct mail', () => {
    const result = detectForwarding(
      {
        subject: 'x',
        from: 'a@example.com',
        deliveredTo: 'test@example.com',
        toHeader: 'test@example.com',
        content: '',
        attachments: 0,
      },
      'test@example.com',
    );
    expect(result.shownAccount).toBe('test@example.com');
  });

  it('shows the original recipient for forwarded mail', () => {
    const result = detectForwarding(
      {
        subject: 'x',
        from: 'a@example.com',
        deliveredTo: 'original@example.net',
        toHeader: 'test@example.com',
        content: '',
        attachments: 0,
      },
      'test@example.com',
    );
    expect(result.shownAccount).toBe('original@example.net');
  });
});
