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

  it('supports traditional Chinese keywords', () => {
    expect(extractVerificationCode('您的驗證碼為 445566')).toBe('445566');
    expect(extractVerificationCode('一次性密碼：AB12CD')).toBe('AB12CD');
  });

  it('supports Japanese keywords', () => {
    expect(extractVerificationCode('認証コードは 778899 です')).toBe('778899');
    expect(extractVerificationCode('ワンタイムパスワード: 246810')).toBe('246810');
  });

  it('supports Russian keywords', () => {
    expect(extractVerificationCode('Ваш код подтверждения: 112233')).toBe('112233');
    expect(extractVerificationCode('Одноразовый пароль — 556677')).toBe('556677');
  });

  it('supports Korean and bare English "code"', () => {
    expect(extractVerificationCode('인증 코드: 246810')).toBe('246810');
    expect(extractVerificationCode('Your code is 987654')).toBe('987654');
  });

  it('supports one-time tokens and verification IDs', () => {
    expect(extractVerificationCode('一次性令牌：AB12CD')).toBe('AB12CD');
    expect(extractVerificationCode('验证 ID：654321')).toBe('654321');
  });

  it('ignores content without a verification keyword', () => {
    expect(extractVerificationCode('订单号 1234567890，请勿泄露')).toBeNull();
  });

  it('ignores codes without digits', () => {
    expect(extractVerificationCode('验证码：ABCDEF')).toBeNull();
  });

  it('ignores codes embedded in URLs or email addresses', () => {
    expect(extractVerificationCode('验证码链接 https://example.com/123456')).toBeNull();
    expect(extractVerificationCode('验证码发送到 user123456@example.com')).toBeNull();
  });
});
