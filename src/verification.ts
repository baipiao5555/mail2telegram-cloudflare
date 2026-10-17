const KEYWORD_PATTERN =
  /(?:验证码|校验码|动态码|确认码|verification\s+code|verify\s+code|security\s+code|one[- ]time\s+(?:code|password)|otp|pin)/i;

const CODE_AFTER_KEYWORD =
  /(?:验证码|校验码|动态码|确认码|verification\s+code|verify\s+code|security\s+code|one[- ]time\s+(?:code|password)|otp|pin)[^\n]{0,40}?\b([A-Za-z0-9]{4,8})\b/gi;

const CODE_BEFORE_KEYWORD =
  /\b([A-Za-z0-9]{4,8})\b[^\n]{0,25}?(?:验证码|校验码|动态码|确认码|verification\s+code|verify\s+code|security\s+code|one[- ]time\s+(?:code|password)|otp|pin)/gi;

function isCodeCandidate(value: string): boolean {
  return /^[A-Za-z0-9]{4,8}$/.test(value) && /\d/.test(value);
}

/**
 * Extracts the first plausible verification code near a verification keyword.
 * Codes must be 4-8 alphanumeric characters and contain at least one digit.
 */
export function extractVerificationCode(text: string): string | null {
  const source = text.replace(/\r\n?/g, '\n').slice(0, 20_000);
  if (!KEYWORD_PATTERN.test(source)) {
    return null;
  }

  // Some mail clients render "123 456" or "123-456"; join those digit groups.
  const compact = source.replace(/(\d)[\s-]+(?=\d)/g, '$1');

  for (const pattern of [CODE_AFTER_KEYWORD, CODE_BEFORE_KEYWORD]) {
    for (const match of compact.matchAll(pattern)) {
      const candidate = match[1];
      if (candidate && isCodeCandidate(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}
