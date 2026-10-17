import { describe, expect, it } from 'vitest';
import { extractVerificationCode } from '../src/verification';

describe('extractVerificationCode', () => {
  it('extracts a numeric code after a Chinese keyword', () => {
    expect(extractVerificationCode('您的验证码是 123456，5 分钟内有效')).toBe('123456');
  });

  it('extracts an alphanumeric code after an English keyword', () => {
    expect(extractVerificationCode('Your verification code is AB12CD.')).toBe('AB12CD');
  });

  it('joins digits separated by spaces or hyphens', () => {
    expect(extractVerificationCode('验证码：12 34 56')).toBe('123456');
    expect(extractVerificationCode('Your OTP is 123-456.')).toBe('123456');
  });

  it('supports a code before the keyword', () => {
    expect(extractVerificationCode('654321 是您的登录验证码')).toBe('654321');
  });

  it('ignores content without a verification keyword', () => {
    expect(extractVerificationCode('订单号 1234567890，请勿泄露')).toBeNull();
  });

  it('ignores codes without digits', () => {
    expect(extractVerificationCode('验证码：ABCDEF')).toBeNull();
  });
});
