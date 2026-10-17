import {
  buildConfigFromStoredSettings,
  defaultStoredSettings,
  loadConfig,
  settingsFromEnv,
  type Env,
  type StoredSettings,
} from './env';
import { idleAll, pollWindowAll } from './idle';
import { pollAll } from './poll';
import {
  deleteStoredSettings,
  hasStoredSettings,
  loadStoredSettings,
  maskSettings,
  mergeSubmittedSettings,
  saveStoredSettings,
  settingsKeyConfigured,
} from './settings';
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
  let loaded;
  try {
    loaded = await loadConfig(env);
  } catch (error) {
    return json({ error: safeError(error, env.TELEGRAM_BOT_TOKEN ?? '') }, 500);
  }

  const config = loaded.config;
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
    listenMode: config.listenMode,
    idleWindowSeconds: config.idleWindowSeconds,
    pollWindowSeconds: config.pollWindowSeconds,
    pollIntervalSeconds: config.pollIntervalSeconds,
    configSource: loaded.source,
    mailboxes,
  });
}

async function handleRun(request: Request, env: Env): Promise<Response> {
  let config;
  try {
    config = (await loadConfig(env)).config;
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
    config = (await loadConfig(env)).config;
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

async function handleGetSettings(env: Env): Promise<Response> {
  if (!env.MAIL2TG_KV) {
    return json({ error: 'MAIL2TG_KV binding is missing' }, 500);
  }

  const keyConfigured = settingsKeyConfigured(env);
  const storedPresent = await hasStoredSettings(env);
  let settings: StoredSettings | null = null;
  let source: 'kv' | 'env' | 'none' = 'none';
  let envError: string | undefined;
  let settingsError: string | undefined;

  if (keyConfigured) {
    try {
      settings = await loadStoredSettings(env);
    } catch (error) {
      settingsError = errorMessage(error);
    }
  }

  if (settings) {
    source = 'kv';
  } else {
    try {
      settings = settingsFromEnv(env);
      source = 'env';
    } catch (error) {
      envError = errorMessage(error);
      settings = defaultStoredSettings();
    }
  }

  return json({
    ...maskSettings(settings, source, {
      settingsKeyConfigured: keyConfigured,
      hasStoredSettings: storedPresent,
      ...(envError ? { envError } : {}),
    }),
    ...(settingsError ? { settingsError } : {}),
  });
}

async function handlePutSettings(request: Request, env: Env): Promise<Response> {
  if (!settingsKeyConfigured(env)) {
    return json(
      {
        error:
          'SETTINGS_KEY is not configured or invalid. Add a 32-byte key in Cloudflare, then try again.',
      },
      503,
    );
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 256 * 1024) {
    return json({ error: 'settings body is too large' }, 413);
  }
  const body = await request.text();
  if (body.length > 256 * 1024) {
    return json({ error: 'settings body is too large' }, 413);
  }

  let submitted: unknown;
  try {
    submitted = JSON.parse(body);
  } catch {
    return json({ error: 'settings body is not valid JSON' }, 400);
  }

  let existing: StoredSettings;
  try {
    existing = (await loadStoredSettings(env)) ?? settingsFromEnv(env);
  } catch {
    try {
      existing = settingsFromEnv(env);
    } catch {
      existing = defaultStoredSettings();
    }
  }

  let merged: StoredSettings;
  try {
    merged = mergeSubmittedSettings(existing, submitted);
  } catch (error) {
    return json({ error: errorMessage(error) }, 400);
  }

  try {
    buildConfigFromStoredSettings(merged, env.ADMIN_TOKEN?.trim() ?? '');
  } catch (error) {
    return json({ error: errorMessage(error) }, 400);
  }

  try {
    await saveStoredSettings(env, merged);
  } catch (error) {
    return json({ error: errorMessage(error) }, 500);
  }

  return json({ ok: true });
}

async function handleDeleteSettings(env: Env): Promise<Response> {
  try {
    await deleteStoredSettings(env);
    return json({ ok: true });
  } catch (error) {
    return json({ error: errorMessage(error) }, 500);
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
    try {
      const { config } = await loadConfig(env);
      configured = config.mailboxes.length > 0 && (config.dryRun || Boolean(config.chatId));
      mailboxCount = config.mailboxes.length;
    } catch {
      configured = false;
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

  if (url.pathname === '/api/settings') {
    const denied = requireAdmin(request, env);
    if (denied) {
      return denied;
    }
    if (method === 'GET') {
      return handleGetSettings(env);
    }
    if (method === 'PUT') {
      return handlePutSettings(request, env);
    }
    if (method === 'DELETE') {
      return handleDeleteSettings(env);
    }
    return json({ error: 'method not allowed' }, 405);
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
    let source: 'env' | 'kv';
    try {
      const loaded = await loadConfig(env);
      config = loaded.config;
      source = loaded.source;
    } catch (error) {
      console.error(JSON.stringify({ event: 'config-error', error: errorMessage(error) }));
      return;
    }

    if (config.mailboxes.length === 0) {
      console.log('No mailboxes configured; skipping scheduled poll');
      return;
    }

    try {
      const summary =
        config.listenMode === 'idle'
          ? await idleAll(env, config)
          : await pollWindowAll(env, config);
      console.log(
        JSON.stringify({
          event: 'poll-complete',
          cron: controller.cron,
          scheduledTime: controller.scheduledTime,
          configSource: source,
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
