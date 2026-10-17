const KEYWORD_SOURCES = [
  // Simplified Chinese
  '短信验证码',
  '邮箱验证码',
  '验证码',
  '校验码',
  '动态码',
  '确认码',
  '一次性密码',
  '一次性令牌',
  '安全码',
  '登录码',
  '验证\\s*ID',
  '验证码\\s*ID',
  // Traditional Chinese
  '簡訊驗證碼',
  '郵箱驗證碼',
  '驗證碼',
  '校驗碼',
  '動態碼',
  '確認碼',
  '一次性密碼',
  '一次性令牌',
  '安全碼',
  '登入碼',
  '驗證\\s*ID',
  // English
  'verification\\s+code',
  'verify\\s+code',
  'confirmation\\s+code',
  'security\\s+code',
  'authentication\\s+code',
  'login\\s+code',
  'one[\\s-]*time\\s+(?:code|password|passcode|token)',
  'passcode',
  '\\botp\\b',
  '\\btotp\\b',
  '\\bpin\\b',
  '\\bcode\\b',
  // Japanese
  '認証コード',
  '確認コード',
  '検証コード',
  'ワンタイム(?:パスワード|コード)',
  'セキュリティコード',
  'パスコード',
  '暗証番号',
  // Russian
  'код\\s+подтверждения',
  'проверочный\\s+код',
  'одноразовый\\s+(?:код|пароль)',
  'код\\s+безопасности',
  'пин-код',
  // Korean
  '인증\\s*코드',
  '확인\\s*코드',
  '일회용\\s*(?:비밀번호|코드)',
  // German, French, Spanish, Portuguese
  'bestätigungscode',
  'verifizierungscode',
  'code\\s+de\\s+vérification',
  'código\\s+de\\s+verificación',
  'código\\s+de\\s+verificação',
];

const KEYWORD_PATTERN = new RegExp(KEYWORD_SOURCES.join('|'), 'giu');
const CODE_PATTERN = /\b([A-Za-z0-9]{4,8})\b/gu;
const MAX_DISTANCE = 160;

interface Candidate {
  code: string;
  distance: number;
  length: number;
  numeric: boolean;
}

function isUsableCode(code: string, index: number, source: string): boolean {
  if (!/\d/.test(code)) {
    return false;
  }
  const before = index > 0 ? source[index - 1] ?? '' : '';
  const after = source[index + code.length] ?? '';
  // Skip codes embedded in email addresses or URLs.
  if (/[@/]/.test(before) || /[@/]/.test(after)) {
    return false;
  }
  return true;
}

/**
 * Finds a verification code near a keyword in Chinese (simplified/traditional),
 * English, Japanese, Russian, Korean, German, French, Spanish, or Portuguese.
 * Candidates are 4-8 alphanumerics and must contain at least one digit.
 */
export function extractVerificationCode(text: string): string | null {
  const source = text.replace(/\r\n?/g, '\n').slice(0, 20_000);

  // Some mail clients render "123 456" or "123-456"; join digit groups so the
  // code becomes one candidate. The indices still refer to the compacted text.
  const compact = source.replace(/(\d)[\s\-–—]+(?=\d)/g, '$1');

  const keywordPositions: number[] = [];
  for (const match of compact.matchAll(KEYWORD_PATTERN)) {
    if (match.index !== undefined) {
      keywordPositions.push(match.index);
    }
  }
  if (keywordPositions.length === 0) {
    return null;
  }

  const candidates: Candidate[] = [];
  for (const match of compact.matchAll(CODE_PATTERN)) {
    const code = match[1];
    const index = match.index;
    if (!code || index === undefined || !isUsableCode(code, index, compact)) {
      continue;
    }
    let distance = Number.POSITIVE_INFINITY;
    for (const keywordPosition of keywordPositions) {
      distance = Math.min(distance, Math.abs(index - keywordPosition));
    }
    if (distance > MAX_DISTANCE) {
      continue;
    }
    candidates.push({
      code,
      distance,
      length: code.length,
      numeric: /^\d+$/.test(code),
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }
    if (left.length !== right.length) {
      return right.length - left.length;
    }
    if (left.numeric !== right.numeric) {
      return left.numeric ? -1 : 1;
    }
    return 0;
  });

  return candidates[0]!.code;
}
