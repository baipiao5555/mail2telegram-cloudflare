import { describeConfigError, parseConfig, type Env } from './env';
import { pollAll } from './poll';
import { StateStore } from './state';
import { makeSenderOptions, sendTestMessage, telegramErrorForLog } from './telegram';
import { renderDashboardHtml } from './ui';
import { errorMessage, timingSafeEqualString } from './util';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function htmlResponse(html: string, nonce: string): Response {
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    },
  });
}

function isAuthorized(request: Request, adminToken: string): boolean {
  if (!adminToken) {
    return false;
  }
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && timingSafeEqualString(match[1]!.trim(), adminToken));
}

function requireAdmin(request: Request, env: Env): Response | null {
  const token = env.ADMIN_TOKEN?.trim() ?? '';
  if (!token) {
    return json({ error: 'ADMIN_TOKEN is not configured' }, 503);
  }
  if (!isAuthorized(request, token)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'www-authenticate': 'Bearer',
        'cache-control': 'no-store',
      },
    });
  }
  return null;
}

function safeError(error: unknown, token: string): string {
  return telegramErrorForLog(error, token);
}

async function handleStatus(env: Env): Promise<Response> {
  if (!env.MAIL2TG_KV) {
    return json({ error: 'MAIL2TG_KV binding is missing' }, 500);
  }
  let config;
  try {
    config = parseConfig(env);
  } catch (error) {
    return json({ error: safeError(error, env.TELEGRAM_BOT_TOKEN ?? '') }, 500);
  }

  const store = new StateStore(env.MAIL2TG_KV);
  const mailboxes = [];
  for (const mailbox of config.mailboxes) {
    const status = await store.getStatus(mailbox.id);
    mailboxes.push({
      email: mailbox.email,
      name: mailbox.name ?? null,
      lastRunAt: status?.lastRunAt ?? null,
      lastError: status?.lastError ?? null,
      folders: status?.folders ?? {},
    });
  }

  return json({
    language: config.language,
    timeZone: config.timeZone,
    initialSync: config.initialSync,
    dryRun: config.dryRun,
    mailboxes,
  });
}

async function handleRun(request: Request, env: Env): Promise<Response> {
  let config;
  try {
    config = parseConfig(env);
  } catch (error) {
    return json({ error: safeError(error, env.TELEGRAM_BOT_TOKEN ?? '') }, 500);
  }

  const url = new URL(request.url);
  const only = url.searchParams.get('mailbox')?.trim().toLowerCase();
  if (only) {
    config.mailboxes = config.mailboxes.filter((mailbox) => mailbox.email.toLowerCase() === only);
    if (config.mailboxes.length === 0) {
      return json({ error: `mailbox not configured: ${only}` }, 404);
    }
  }
  if (config.mailboxes.length === 0) {
    return json({ error: 'no mailboxes configured' }, 400);
  }

  try {
    const summary = await pollAll(env, config);
    return json(summary);
  } catch (error) {
    const message = safeError(error, config.telegramToken);
    console.error(JSON.stringify({ event: 'manual-run-failed', error: message }));
    return json({ error: message }, 500);
  }
}

async function handleTelegramTest(env: Env): Promise<Response> {
  let config;
  try {
    config = parseConfig(env);
  } catch (error) {
    return json({ error: safeError(error, env.TELEGRAM_BOT_TOKEN ?? '') }, 500);
  }
  if (!config.chatId && !config.dryRun) {
    return json({ error: 'TELEGRAM_CHAT_ID is not configured' }, 400);
  }

  try {
    const sender = makeSenderOptions(config.telegramToken, config.chatId, config.dryRun);
    await sendTestMessage(sender, config.chatId);
    return json({ ok: true, dryRun: config.dryRun });
  } catch (error) {
    return json({ error: safeError(error, config.telegramToken) }, 500);
  }
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (url.pathname === '/health') {
    if (method !== 'GET' && method !== 'HEAD') {
      return json({ error: 'method not allowed' }, 405);
    }
    let configured = false;
    let mailboxCount = 0;
    if (!describeConfigError(env)) {
      try {
        const config = parseConfig(env);
        configured = config.mailboxes.length > 0 && (config.dryRun || Boolean(config.chatId));
        mailboxCount = config.mailboxes.length;
      } catch {
        configured = false;
      }
    }
    return json({
      ok: true,
      service: 'mail2telegram-cloudflare',
      configured,
      mailboxes: mailboxCount,
      time: new Date().toISOString(),
    });
  }

  if (url.pathname === '/' || url.pathname === '/dashboard') {
    if (method !== 'GET' && method !== 'HEAD') {
      return json({ error: 'method not allowed' }, 405);
    }
    const nonce = crypto.randomUUID();
    return htmlResponse(method === 'HEAD' ? '' : renderDashboardHtml(nonce), nonce);
  }

  if (url.pathname === '/status') {
    if (method !== 'GET') {
      return json({ error: 'method not allowed' }, 405);
    }
    const denied = requireAdmin(request, env);
    return denied ?? handleStatus(env);
  }

  if (url.pathname === '/run') {
    if (method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }
    const denied = requireAdmin(request, env);
    return denied ?? handleRun(request, env);
  }

  if (url.pathname === '/telegram/test') {
    if (method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }
    const denied = requireAdmin(request, env);
    return denied ?? handleTelegramTest(env);
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.MAIL2TG_KV) {
      console.error('MAIL2TG_KV binding is missing; create the KV namespace and update wrangler.toml');
      return;
    }

    let config;
    try {
      config = parseConfig(env);
    } catch (error) {
      console.error(JSON.stringify({ event: 'config-error', error: errorMessage(error) }));
      return;
    }

    if (config.mailboxes.length === 0) {
      console.log('No mailboxes configured; skipping scheduled poll');
      return;
    }

    try {
      const summary = await pollAll(env, config);
      console.log(
        JSON.stringify({
          event: 'poll-complete',
          cron: controller.cron,
          scheduledTime: controller.scheduledTime,
          ...summary,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'scheduled-poll-failed',
          error: telegramErrorForLog(error, config.telegramToken),
        }),
      );
    }
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleFetch(request, env);
    } catch (error) {
      console.error(JSON.stringify({ event: 'http-handler-failed', error: errorMessage(error) }));
      return json({ error: 'internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
