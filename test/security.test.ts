import { describe, expect, it } from 'vitest';
import { assertSafeHost, isPrivateAddress } from '../src/security';

describe('assertSafeHost', () => {
  it('accepts public hostnames and public IPs', () => {
    expect(assertSafeHost('imap.gmail.com')).toBe('imap.gmail.com');
    expect(assertSafeHost('IMAP.QQ.COM.')).toBe('imap.qq.com');
    expect(assertSafeHost('8.8.8.8')).toBe('8.8.8.8');
    expect(assertSafeHost('2606:4700:4700::1111')).toBe('2606:4700:4700::1111');
  });

  it.each([
    'localhost',
    'imap.localhost',
    'imap.local',
    'server.internal',
    'printer.lan',
    'router.home.arpa',
    'foo.test',
    'foo.invalid',
    'foo.example',
    'singlelabel',
  ])('rejects reserved hostname %s', (host) => {
    expect(() => assertSafeHost(host)).toThrow();
  });

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
  ])('rejects private or reserved IP %s', (host) => {
    expect(() => assertSafeHost(host)).toThrow();
  });

  it('rejects schemes, credentials, paths, and ports', () => {
    for (const host of [
      'https://imap.gmail.com',
      'user@imap.gmail.com',
      'imap.gmail.com/path',
      'imap.gmail.com:993',
      'imap gmail.com',
    ]) {
      expect(() => assertSafeHost(host)).toThrow();
    }
  });
});

describe('isPrivateAddress', () => {
  it('handles decorated remote addresses', () => {
    expect(isPrivateAddress('127.0.0.1:993')).toBe(true);
    expect(isPrivateAddress('[::1]:993')).toBe(true);
    expect(isPrivateAddress('10.0.0.5:143')).toBe(true);
    expect(isPrivateAddress('8.8.8.8:993')).toBe(false);
    expect(isPrivateAddress('[2606:4700:4700::1111]:993')).toBe(false);
    expect(isPrivateAddress('')).toBe(true);
  });
});
