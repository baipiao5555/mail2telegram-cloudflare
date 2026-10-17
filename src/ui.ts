/**
 * Self-contained dashboard served by the Worker. All dynamic data is fetched from
 * /status, /run, and /telegram/test with the ADMIN_TOKEN held in sessionStorage.
 */
export function renderDashboardHtml(nonce: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex,nofollow">
<title>Mail2Telegram · 控制台</title>
<style nonce="${nonce}">
:root{
  --bg:#05080f;
  --panel:rgba(15,23,42,.78);
  --panel-2:rgba(15,23,42,.55);
  --border:rgba(148,163,184,.16);
  --text:#e2e8f0;
  --muted:#94a3b8;
  --faint:#64748b;
  --accent:#38bdf8;
  --ok:#34d399;
  --warn:#fbbf24;
  --error:#fb7185;
  --radius:18px;
  --shadow:0 24px 80px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
html,body{min-height:100%}
body{
  margin:0;
  background:
    radial-gradient(1200px 600px at 15% -10%,rgba(56,189,248,.16),transparent 60%),
    radial-gradient(1000px 500px at 85% 0%,rgba(129,140,248,.14),transparent 55%),
    var(--bg);
  color:var(--text);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans SC",sans-serif;
  line-height:1.5;
  -webkit-font-smoothing:antialiased;
}
body::before{
  content:"";
  position:fixed;
  inset:0;
  pointer-events:none;
  background-image:
    linear-gradient(rgba(148,163,184,.045) 1px,transparent 1px),
    linear-gradient(90deg,rgba(148,163,184,.045) 1px,transparent 1px);
  background-size:48px 48px;
  mask-image:radial-gradient(ellipse at top,black,transparent 75%);
}
.shell{position:relative;max-width:1120px;margin:0 auto;padding:34px 20px 48px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:28px}
.brand{display:flex;align-items:center;gap:14px}
.logo{
  width:52px;height:52px;border-radius:16px;flex:0 0 auto;
  background:linear-gradient(135deg,#0ea5e9,#6366f1);
  display:grid;place-items:center;color:#fff;
  box-shadow:0 10px 30px rgba(56,189,248,.25);
}
.logo svg{width:28px;height:28px}
h1{font-size:20px;margin:0;letter-spacing:-.01em}
.brand p{margin:2px 0 0;color:var(--muted);font-size:13px}
.chip{
  display:inline-flex;align-items:center;gap:8px;
  padding:7px 11px;border-radius:999px;
  border:1px solid var(--border);
  font-size:12.5px;font-weight:600;color:var(--muted);
  background:rgba(15,23,42,.6);white-space:nowrap;
}
.chip .dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px rgba(148,163,184,.12)}
.chip-ok{color:var(--ok);border-color:rgba(52,211,153,.28);background:rgba(52,211,153,.08)}
.chip-ok .dot{box-shadow:0 0 0 3px rgba(52,211,153,.12)}
.chip-error{color:var(--error);border-color:rgba(251,113,133,.28);background:rgba(251,113,133,.08)}
.chip-error .dot{box-shadow:0 0 0 3px rgba(251,113,133,.12)}
.chip-warn{color:var(--warn);border-color:rgba(251,191,36,.28);background:rgba(251,191,36,.08)}
.chip-warn .dot{box-shadow:0 0 0 3px rgba(251,191,36,.12)}
.panel{
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
  backdrop-filter:blur(16px);
}
.login{max-width:460px;margin:9vh auto 0;padding:34px;text-align:center}
.lock-icon{
  width:58px;height:58px;margin:0 auto 18px;border-radius:18px;
  background:rgba(56,189,248,.1);border:1px solid rgba(56,189,248,.22);
  display:grid;place-items:center;color:var(--accent);
}
.lock-icon svg{width:28px;height:28px}
.login h2{margin:0 0 8px;font-size:22px}
.login p{margin:0 0 20px;font-size:13.5px}
code{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  background:rgba(148,163,184,.12);padding:2px 6px;border-radius:6px;font-size:.9em;
}
.login-form{display:flex;gap:10px}
.login-form input{
  flex:1;min-width:0;
  background:rgba(2,6,23,.65);
  border:1px solid var(--border);
  border-radius:12px;
  padding:12px 14px;
  color:var(--text);
  font:inherit;font-size:14px;
  outline:none;
  transition:border-color .15s,box-shadow .15s;
}
.login-form input:focus{border-color:rgba(56,189,248,.6);box-shadow:0 0 0 3px rgba(56,189,248,.12)}
.btn{
  appearance:none;border:1px solid var(--border);
  background:rgba(148,163,184,.08);
  color:var(--text);border-radius:12px;
  padding:11px 16px;font:inherit;font-size:13.5px;font-weight:650;
  cursor:pointer;white-space:nowrap;
  transition:transform .12s,background .15s,border-color .15s,opacity .15s;
}
.btn:hover{background:rgba(148,163,184,.14);border-color:rgba(148,163,184,.28)}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.55;cursor:not-allowed}
.btn.primary{
  background:linear-gradient(135deg,#0ea5e9,#6366f1);
  border-color:transparent;color:#fff;
  box-shadow:0 10px 24px rgba(56,189,248,.22);
}
.btn.primary:hover{filter:brightness(1.06)}
.btn.ghost{background:transparent}
.btn.danger-ghost{background:transparent;color:var(--error);border-color:rgba(251,113,133,.25)}
.btn.danger-ghost:hover{background:rgba(251,113,133,.08)}
.banner{
  padding:14px 16px;border-radius:14px;
  border:1px solid rgba(251,191,36,.25);
  background:rgba(251,191,36,.08);
  color:#fde68a;font-size:13.5px;margin-bottom:18px;
}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
.stat{padding:18px;border-radius:16px;background:var(--panel-2);border:1px solid var(--border)}
.stat-label{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);font-weight:700}
.stat-value{font-size:24px;font-weight:750;margin-top:8px;letter-spacing:-.02em;overflow-wrap:anywhere}
.stat-value.compact{font-size:16px;line-height:1.35}
.stat-sub{font-size:12px;color:var(--muted);margin-top:4px}
.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 14px}
.meta-line{color:var(--faint);font-size:12.5px;margin-bottom:18px;display:flex;flex-wrap:wrap;gap:8px 16px}
.accounts{display:grid;gap:16px}
.account{padding:20px}
.account-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.account h3{margin:0;font-size:16px;overflow-wrap:anywhere}
.account-sub{color:var(--muted);font-size:12.5px;margin-top:3px;overflow-wrap:anywhere}
.account-meta{display:flex;flex-wrap:wrap;gap:8px}
.folder-table{margin-top:16px;border:1px solid var(--border);border-radius:14px;overflow:hidden}
.folder-row{
  display:grid;
  grid-template-columns:minmax(140px,2fr) minmax(70px,.7fr) minmax(110px,1fr) minmax(140px,1.4fr);
  gap:12px;padding:11px 14px;font-size:13px;
  border-top:1px solid var(--border);align-items:center;
}
.folder-row:first-child{border-top:0}
.folder-head{background:rgba(148,163,184,.06);color:var(--faint);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.folder-name{font-weight:600;overflow-wrap:anywhere}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;color:var(--muted)}
.muted{color:var(--muted)}
.small{font-size:12px}
.empty{padding:26px;text-align:center;color:var(--muted);font-size:13.5px}
.error-text{color:var(--error);font-size:13px;min-height:20px;margin:10px 0 0}
.error-box{
  margin-top:14px;padding:12px 14px;border-radius:12px;
  border:1px solid rgba(251,113,133,.22);
  background:rgba(251,113,133,.07);
  color:#fecdd3;font-size:12.5px;
  overflow-wrap:anywhere;white-space:pre-wrap;
}
.banner.error{
  border-color:rgba(251,113,133,.25);
  background:rgba(251,113,133,.08);
  color:#fecdd3;
}
.settings-panel{padding:22px}
.settings-head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.settings-head h2{margin:0 0 4px;font-size:20px}
.settings-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start}
.settings-actions .btn{flex:0 0 auto}
.form-section{border-top:1px solid var(--border);padding-top:20px;margin-top:20px}
.form-section:first-of-type{border-top:0;padding-top:0;margin-top:0}
.form-section h3{margin:0 0 12px;font-size:15px}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.section-head h3{margin:0}
.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.field{display:flex;flex-direction:column;gap:6px;min-width:0}
.field>span{font-size:12px;color:var(--muted);font-weight:600}
.field input,.field select{
  width:100%;min-width:0;
  background:rgba(2,6,23,.65);
  border:1px solid var(--border);
  border-radius:10px;
  padding:10px 12px;
  color:var(--text);
  font:inherit;font-size:13.5px;
  outline:none;
  transition:border-color .15s,box-shadow .15s;
}
.field input:focus,.field select:focus{
  border-color:rgba(56,189,248,.6);
  box-shadow:0 0 0 3px rgba(56,189,248,.12);
}
.field .hint{font-size:11.5px;color:var(--faint)}
.checkbox-field{flex-direction:row;align-items:center;gap:8px;padding-top:22px}
.checkbox-field input{width:16px;height:16px;accent-color:var(--accent);padding:0}
.mailbox-card{
  border:1px solid var(--border);
  border-radius:14px;
  padding:16px;
  margin-bottom:12px;
  background:rgba(2,6,23,.35);
}
.mailbox-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}
.mailbox-head strong{font-size:13.5px}
.settings-footer{
  display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;
  border-top:1px solid var(--border);margin-top:22px;padding-top:18px;
}
.settings-note{color:var(--faint);font-size:12px;margin:14px 0 0}
.settings-source{color:var(--faint);font-size:12px;margin-top:4px}
@media (max-width:640px){
  .form-grid{grid-template-columns:1fr}
  .settings-head{align-items:stretch}
  .settings-actions{width:100%}
  .settings-actions .btn{flex:1 1 auto}
  .settings-footer .btn{flex:1 1 auto}
}
.footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:30px;color:var(--faint);font-size:12px}
.footer a{color:var(--muted);text-decoration:none}
.footer a:hover{color:var(--accent)}
.toast{
  position:fixed;right:22px;bottom:22px;max-width:420px;
  padding:13px 16px;border-radius:14px;border:1px solid var(--border);
  background:#0f172a;box-shadow:0 20px 60px rgba(0,0,0,.4);
  font-size:13.5px;z-index:20;transition:opacity .2s,transform .2s;
}
.toast.ok{border-color:rgba(52,211,153,.3);background:rgba(6,78,59,.92);color:#d1fae5}
.toast.warn{border-color:rgba(251,191,36,.3);background:rgba(69,26,3,.92);color:#fef3c7}
.toast.error{border-color:rgba(251,113,133,.3);background:rgba(76,5,25,.92);color:#ffe4e6}
.toast.hidden{opacity:0;transform:translateY(8px);pointer-events:none}
.hidden{display:none!important}
@media (max-width:820px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){
  .shell{padding:22px 14px 36px}
  .topbar{align-items:flex-start;flex-direction:column}
  .login{margin-top:4vh;padding:26px 20px}
  .login-form{flex-direction:column}
  .toolbar .btn{flex:1 1 auto}
  .folder-row{grid-template-columns:1.6fr .7fr 1fr}
  .folder-row>:nth-child(3){display:none}
  .stat-value{font-size:21px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>
</head>
<body>
<main class="shell">
  <header class="topbar">
    <div class="brand">
      <div class="logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.8"/>
          <path d="M4 7.5 12 13l8-5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div>
        <h1>Mail2Telegram</h1>
        <p>Cloudflare Workers 邮件转发控制台</p>
      </div>
    </div>
    <div id="statusChip" class="chip">
      <span class="dot"></span>
      <span id="statusChipText">加载中</span>
    </div>
  </header>

  <section id="loginPanel" class="panel login hidden">
    <div class="lock-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" stroke-width="1.8"/>
        <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <circle cx="12" cy="15" r="1.4" fill="currentColor"/>
      </svg>
    </div>
    <h2>连接控制台</h2>
    <p class="muted">输入部署时设置的 <code>ADMIN_TOKEN</code>。Token 只保存在当前标签页，关闭页面后自动清除。</p>
    <form id="loginForm" class="login-form">
      <input id="tokenInput" type="password" autocomplete="current-password" placeholder="ADMIN_TOKEN" spellcheck="false">
      <button class="btn primary" type="submit">连接</button>
    </form>
    <p id="loginError" class="error-text" role="alert"></p>
    <p id="healthHint" class="muted small"></p>
  </section>

  <section id="dashboard" class="hidden">
    <div id="configBanner" class="banner hidden" role="status"></div>
    <div class="stats" id="stats"></div>
    <div class="toolbar">
      <button id="refreshBtn" class="btn ghost" type="button">刷新状态</button>
      <button id="runBtn" class="btn primary" type="button">立即运行</button>
      <button id="testBtn" class="btn" type="button">发送测试消息</button>
      <button id="settingsBtn" class="btn ghost" type="button">设置</button>
      <button id="logoutBtn" class="btn danger-ghost" type="button">退出</button>
    </div>
    <div id="metaLine" class="meta-line"></div>
    <div id="accounts" class="accounts"></div>
  </section>

  <section id="settingsView" class="hidden">
    <div id="settingsBanner" class="banner hidden" role="status"></div>
    <div class="panel settings-panel">
      <div class="settings-head">
        <div>
          <h2>设置</h2>
          <p class="muted small">保存后写入 KV 并立即生效，不需要重新部署。</p>
          <p id="settingsSource" class="settings-source"></p>
        </div>
        <div class="settings-actions">
          <button id="settingsBackBtn" class="btn ghost" type="button">返回控制台</button>
          <button id="saveSettingsBtn" class="btn primary" type="button">保存设置</button>
        </div>
      </div>
      <div id="settingsForm"><div class="empty">正在读取设置…</div></div>
      <div class="settings-footer">
        <button id="resetSettingsBtn" class="btn danger-ghost" type="button">恢复环境变量配置</button>
        <button id="settingsBackBtn2" class="btn ghost" type="button">返回控制台</button>
      </div>
      <p class="settings-note">ADMIN_TOKEN 和 SETTINGS_KEY 只能在 Cloudflare 修改。已保存的密码不会回显，留空表示保持不变。</p>
    </div>
  </section>

  <footer class="footer">
    <span>Mail2Telegram for Cloudflare Workers</span>
    <a href="https://github.com/baipiao5555/mail2telegram-cloudflare" target="_blank" rel="noreferrer">GitHub</a>
  </footer>
</main>

<div id="toast" class="toast hidden" role="status"></div>
<noscript><div class="shell"><div class="banner">控制台需要启用 JavaScript。管理接口仍可直接调用。</div></div></noscript>

<script nonce="${nonce}">
(function () {
  'use strict';

  var TOKEN_KEY = 'm2t_admin_token';
  var state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    health: null,
    status: null,
    settings: null,
    view: 'login',
    busy: false
  };
  var toastTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (char) {
      if (char === '&') return '&amp;';
      if (char === '<') return '&lt;';
      if (char === '>') return '&gt;';
      if (char === '"') return '&quot;';
      return '&#39;';
    });
  }

  function fmtDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    try {
      return date.toLocaleString('zh-CN', { hour12: false });
    } catch (error) {
      return date.toISOString();
    }
  }

  function setChip(text, kind) {
    var chip = $('statusChip');
    chip.className = 'chip chip-' + (kind || 'muted');
    $('statusChipText').textContent = text;
  }

  function toast(message, kind) {
    var el = $('toast');
    el.textContent = message;
    el.className = 'toast ' + (kind || 'ok');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.add('hidden');
    }, 6000);
  }

  function showLogin(message) {
    state.view = 'login';
    $('settingsView').classList.add('hidden');
    $('dashboard').classList.add('hidden');
    $('loginPanel').classList.remove('hidden');
    $('loginError').textContent = message || '';
    if (message) {
      setChip('连接失败', 'error');
    } else if (state.health && state.health.configured === false) {
      setChip('配置异常', 'error');
    } else {
      setChip('未连接', 'muted');
    }
    setTimeout(function () {
      $('tokenInput').focus();
    }, 50);
  }

  function showDashboard() {
    state.view = 'dashboard';
    $('settingsView').classList.add('hidden');
    $('loginPanel').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
  }

  function showSettingsView() {
    state.view = 'settings';
    $('loginPanel').classList.add('hidden');
    $('dashboard').classList.add('hidden');
    $('settingsView').classList.remove('hidden');
  }

  function setBusy(busy) {
    state.busy = busy;
    $('refreshBtn').disabled = busy;
    $('runBtn').disabled = busy;
    $('testBtn').disabled = busy;
    $('settingsBtn').disabled = busy;
  }

  async function api(path, options) {
    var opts = options || {};
    var headers = new Headers(opts.headers || {});
    if (state.token) {
      headers.set('Authorization', 'Bearer ' + state.token);
    }
    var response = await fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body,
      cache: 'no-store'
    });
    var data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (!response.ok) {
      var message = data && data.error ? data.error : 'HTTP ' + response.status;
      var failure = new Error(message);
      failure.status = response.status;
      throw failure;
    }
    return data;
  }

  async function loadHealth() {
    try {
      state.health = await api('/health');
      if (state.health.configured === false) {
        $('healthHint').textContent = 'Worker 已部署，但配置尚未完成。请检查 Cloudflare 的 Variables and Secrets。';
        $('configBanner').textContent = '云端配置不完整：/health 返回 configured=false。请检查 MAILBOXES、TELEGRAM_BOT_TOKEN、TELEGRAM_CHAT_ID。';
        $('configBanner').classList.remove('hidden');
        if (!state.token) setChip('配置异常', 'error');
      } else {
        $('healthHint').textContent = 'Worker 已部署 · ' + (state.health.mailboxes || 0) + ' 个邮箱账号';
        $('configBanner').classList.add('hidden');
      }
    } catch (error) {
      $('healthHint').textContent = '无法读取 /health：' + error.message;
      if (!state.token) setChip('无法连接', 'error');
    }
  }

  async function loadStatus(silent) {
    if (!state.token) {
      showLogin('');
      return;
    }
    if (!silent) setBusy(true);
    try {
      var data = await api('/status');
      state.status = data;
      renderStatus(data);
      if (state.view !== 'settings') {
        showDashboard();
      }
      setChip('已连接', 'ok');
      if (state.health && state.health.configured === false) {
        $('configBanner').textContent = '云端配置不完整：/health 返回 configured=false。请检查 MAILBOXES、TELEGRAM_BOT_TOKEN、TELEGRAM_CHAT_ID。';
        $('configBanner').classList.remove('hidden');
      }
    } catch (error) {
      if (error.status === 401) {
        state.token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        showLogin('ADMIN_TOKEN 无效，请重新输入。');
      } else if (error.status === 503) {
        showLogin('Worker 尚未配置 ADMIN_TOKEN，管理接口已禁用。');
      } else if (silent) {
        toast('自动刷新失败：' + error.message, 'error');
      } else {
        showLogin('读取状态失败：' + error.message);
      }
    } finally {
      if (!silent) setBusy(false);
    }
  }

  function statCard(label, value, sub, compact) {
    return '<div class="stat">' +
      '<div class="stat-label">' + esc(label) + '</div>' +
      '<div class="stat-value' + (compact ? ' compact' : '') + '">' + esc(value) + '</div>' +
      '<div class="stat-sub">' + esc(sub) + '</div>' +
    '</div>';
  }

  function renderMailbox(mailbox) {
    var folders = mailbox.folders || {};
    var names = Object.keys(folders);
    var rows = names.map(function (name) {
      var folder = folders[name] || {};
      var uid = folder.uid === undefined || folder.uid === null ? '—' : folder.uid;
      var uidValidity = folder.uidValidity === undefined || folder.uidValidity === null ? '—' : folder.uidValidity;
      return '<div class="folder-row">' +
        '<span class="folder-name" title="' + esc(name) + '">' + esc(name) + '</span>' +
        '<span class="mono">' + esc(uid) + '</span>' +
        '<span class="mono">' + esc(uidValidity) + '</span>' +
        '<span class="muted">' + esc(fmtDate(folder.lastForwardedAt)) + '</span>' +
      '</div>';
    }).join('');

    var folderBlock = names.length
      ? '<div class="folder-table">' +
          '<div class="folder-row folder-head"><span>文件夹</span><span>UID</span><span>UIDVALIDITY</span><span>最近转发</span></div>' +
          rows +
        '</div>'
      : '<div class="empty">尚无运行记录，点击「立即运行」开始。</div>';

    var errorBlock = mailbox.lastError
      ? '<div class="error-box"><strong>最近错误：</strong>\\n' + esc(mailbox.lastError) + '</div>'
      : '';

    var displayName = mailbox.name ? ' · ' + esc(mailbox.name) : '';
    var runText = mailbox.lastRunAt ? '最近运行 ' + esc(fmtDate(mailbox.lastRunAt)) : '尚未运行';

    return '<article class="panel account">' +
      '<div class="account-head">' +
        '<div><h3>' + esc(mailbox.email) + '</h3><div class="account-sub">' + runText + displayName + '</div></div>' +
        '<div class="account-meta">' +
          (mailbox.lastError
            ? '<span class="chip chip-error"><span class="dot"></span>异常</span>'
            : '<span class="chip chip-ok"><span class="dot"></span>正常</span>') +
        '</div>' +
      '</div>' +
      errorBlock +
      folderBlock +
    '</article>';
  }

  function renderStatus(data) {
    var mailboxes = data.mailboxes || [];
    var folderCount = 0;
    var errorCount = 0;
    var lastRun = null;

    mailboxes.forEach(function (mailbox) {
      folderCount += Object.keys(mailbox.folders || {}).length;
      if (mailbox.lastError) errorCount += 1;
      if (mailbox.lastRunAt && (!lastRun || mailbox.lastRunAt > lastRun)) {
        lastRun = mailbox.lastRunAt;
      }
    });

    $('stats').innerHTML =
      statCard('邮箱账号', String(mailboxes.length), '已配置', false) +
      statCard('监控文件夹', String(folderCount), 'KV 游标', false) +
      statCard('最近运行', lastRun ? fmtDate(lastRun) : '—', data.dryRun ? 'DRY RUN' : '自动轮询', true) +
      statCard('异常', String(errorCount), errorCount ? '需要处理' : '全部正常', false);

    $('metaLine').innerHTML =
      '<span>语言：' + esc(data.language || '—') + '</span>' +
      '<span>时区：' + esc(data.timeZone || '—') + '</span>' +
      '<span>首次同步：' + esc(data.initialSync || '—') + '</span>' +
      '<span>模式：' + (data.dryRun ? 'DRY RUN（不发送）' : '正常发送') + '</span>';

    if (!mailboxes.length) {
      $('accounts').innerHTML = '<div class="panel empty">尚未配置邮箱。请到 Cloudflare Worker 的 <code>Variables and Secrets</code> 设置 <code>MAILBOXES</code>，然后刷新。</div>';
      return;
    }

    $('accounts').innerHTML = mailboxes.map(renderMailbox).join('');
  }

  async function runNow() {
    if (state.busy) return;
    setBusy(true);
    try {
      var summary = await api('/run', { method: 'POST' });
      var forwarded = 0;
      var errors = 0;
      (summary.mailboxes || []).forEach(function (mailbox) {
        if (mailbox.error) errors += 1;
        (mailbox.folders || []).forEach(function (folder) {
          forwarded += folder.forwarded || 0;
          if (folder.error) errors += 1;
        });
      });
      toast('运行完成：转发 ' + forwarded + ' 封邮件' + (errors ? '，' + errors + ' 个错误' : ''), errors ? 'warn' : 'ok');
      await loadStatus(true);
    } catch (error) {
      toast('运行失败：' + error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (state.busy) return;
    setBusy(true);
    try {
      var result = await api('/telegram/test', { method: 'POST' });
      toast(result && result.dryRun ? 'Dry-run：未实际发送 Telegram 消息。' : '测试消息已发送，请查看 Telegram。', 'ok');
    } catch (error) {
      toast('发送失败：' + error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function mailboxEditorHtml(mailbox, index) {
    var folders = mailbox.folders && mailbox.folders.length ? mailbox.folders.join(', ') : '';
    var passwordPlaceholder = mailbox.passwordConfigured ? '已设置，留空保持不变' : '必填';
    return '<div class="mailbox-card">' +
      '<div class="mailbox-head"><strong class="mailbox-title">邮箱 ' + (index + 1) + '</strong>' +
        '<button class="btn danger-ghost remove-mailbox" type="button">删除</button></div>' +
      '<div class="form-grid">' +
        '<label class="field"><span>邮箱地址</span><input data-field="email" type="text" value="' + esc(mailbox.email || '') + '" placeholder="you@gmail.com"></label>' +
        '<label class="field"><span>应用密码 / 授权码</span><input data-field="password" type="password" value="" placeholder="' + esc(passwordPlaceholder) + '" autocomplete="new-password"></label>' +
        '<label class="field"><span>IMAP 服务器</span><input data-field="host" type="text" value="' + esc(mailbox.host || 'imap.gmail.com') + '"></label>' +
        '<label class="field"><span>端口</span><input data-field="port" type="number" value="' + (mailbox.port || 993) + '"></label>' +
        '<label class="field"><span>文件夹（逗号分隔，可留空自动发现）</span><input data-field="folders" type="text" value="' + esc(folders) + '" placeholder="INBOX, Junk"></label>' +
        '<label class="field"><span>显示名称（可选）</span><input data-field="name" type="text" value="' + esc(mailbox.name || '') + '"></label>' +
      '</div>' +
    '</div>';
  }

  function renderSettings(data) {
    var keyOk = data.settingsKeyConfigured === true;
    var messages = [];
    if (!keyOk) {
      messages.push('SETTINGS_KEY 未配置或无效。请在 Cloudflare Worker 的 Variables and Secrets 添加 32 字节随机密钥（openssl rand -hex 32），然后刷新本页。');
      if (data.hasStoredSettings) {
        messages.push('检测到已保存的加密配置，但当前 SETTINGS_KEY 无法解密。');
      }
    }
    if (data.settingsError) messages.push('已保存配置无法解密：' + data.settingsError);
    if (data.envError) messages.push('环境变量配置读取失败：' + data.envError);

    var banner = $('settingsBanner');
    if (messages.length) {
      banner.innerHTML = messages.map(esc).join('<br>');
      banner.classList.remove('hidden');
      if (data.settingsError || (!keyOk && data.hasStoredSettings)) {
        banner.classList.add('error');
      } else {
        banner.classList.remove('error');
      }
    } else {
      banner.classList.add('hidden');
      banner.classList.remove('error');
    }

    var sourceText = data.source === 'kv'
      ? 'KV（网页设置）'
      : data.source === 'env'
        ? 'Cloudflare 环境变量'
        : '默认值';
    $('settingsSource').textContent = '当前配置来源：' + sourceText;

    var telegram = data.telegram || {};
    var general = data.general || {};
    var mailboxes = data.mailboxes || [];
    var mailboxHtml = mailboxes.map(mailboxEditorHtml).join('');
    if (!mailboxes.length) {
      mailboxHtml = '<div class="empty">还没有邮箱账号，点击「添加邮箱」开始。</div>';
    }

    var languageOptions =
      '<option value="Chinese"' + (general.language === 'Chinese' ? ' selected' : '') + '>中文</option>' +
      '<option value="English"' + (general.language === 'English' ? ' selected' : '') + '>English</option>';
    var syncOptions =
      '<option value="skip"' + (general.initialSync === 'skip' ? ' selected' : '') + '>skip（跳过历史邮件）</option>' +
      '<option value="latest"' + (general.initialSync === 'latest' ? ' selected' : '') + '>latest（只发最新一封）</option>';

    $('settingsForm').innerHTML =
      '<section class="form-section">' +
        '<h3>Telegram</h3>' +
        '<div class="form-grid">' +
          '<label class="field"><span>Bot Token</span><input id="setTelegramToken" type="password" value="" placeholder="' + (telegram.tokenConfigured ? '已设置，留空保持不变' : '粘贴 Bot Token') + '" autocomplete="new-password"></label>' +
          '<label class="field"><span>普通邮件 Chat ID</span><input id="setChatId" type="text" value="' + esc(telegram.chatId || '') + '" placeholder="-1001234567890"></label>' +
          '<label class="field"><span>垃圾邮件 Chat ID（可选）</span><input id="setJunkChatId" type="text" value="' + esc(telegram.junkChatId || '') + '" placeholder="留空则不转发垃圾邮件"></label>' +
        '</div>' +
      '</section>' +
      '<section class="form-section">' +
        '<div class="section-head"><h3>邮箱账号</h3><button id="addMailboxBtn" class="btn ghost" type="button">添加邮箱</button></div>' +
        '<div id="mailboxList">' + mailboxHtml + '</div>' +
      '</section>' +
      '<section class="form-section">' +
        '<h3>通用设置</h3>' +
        '<div class="form-grid">' +
          '<label class="field"><span>语言</span><select id="setLanguage">' + languageOptions + '</select></label>' +
          '<label class="field"><span>时区（IANA）</span><input id="setTimeZone" type="text" value="' + esc(general.timeZone || 'Asia/Shanghai') + '" placeholder="Asia/Shanghai"></label>' +
          '<label class="field"><span>首次运行</span><select id="setInitialSync">' + syncOptions + '</select></label>' +
          '<label class="field"><span>正文最大字符数</span><input id="setMaxEmailChars" type="number" min="100" max="20000" value="' + (general.maxEmailChars || 3000) + '"></label>' +
          '<label class="field"><span>单封邮件最大字节数</span><input id="setMaxEmailBytes" type="number" min="1024" max="26214400" value="' + (general.maxEmailBytes || 10485760) + '"></label>' +
          '<label class="field"><span>每文件夹每轮最多处理</span><input id="setMaxMessagesPerRun" type="number" min="1" max="200" value="' + (general.maxMessagesPerRun || 20) + '"></label>' +
          '<label class="checkbox-field field"><input id="setLoginNotify" type="checkbox"' + (general.loginNotify ? ' checked' : '') + '><span>首次登录时发送 Telegram 通知</span></label>' +
          '<label class="checkbox-field field"><input id="setDedupe" type="checkbox"' + (general.dedupe ? ' checked' : '') + '><span>按 Message-ID 去重</span></label>' +
          '<label class="checkbox-field field"><input id="setDryRun" type="checkbox"' + (general.dryRun ? ' checked' : '') + '><span>DRY RUN（只记录，不发送 Telegram）</span></label>' +
        '</div>' +
      '</section>';
    $('saveSettingsBtn').disabled = !keyOk;
  }

  async function openSettings() {
    if (!state.token) {
      showLogin('');
      return;
    }
    showSettingsView();
    $('settingsBanner').classList.add('hidden');
    $('settingsForm').innerHTML = '<div class="empty">正在读取设置…</div>';
    try {
      var data = await api('/api/settings');
      state.settings = data;
      renderSettings(data);
    } catch (error) {
      if (error.status === 401) {
        state.token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        showLogin('ADMIN_TOKEN 无效，请重新输入。');
      } else if (error.status === 503) {
        showLogin('Worker 尚未配置 ADMIN_TOKEN，管理接口已禁用。');
      } else {
        $('settingsBanner').textContent = '读取设置失败：' + error.message;
        $('settingsBanner').classList.add('error');
        $('settingsBanner').classList.remove('hidden');
        $('settingsForm').innerHTML = '<div class="empty">无法读取设置。</div>';
      }
    }
  }

  function collectSettings() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.mailbox-card'));
    var mailboxes = cards.map(function (card) {
      function value(field) {
        var input = card.querySelector('[data-field="' + field + '"]');
        return input ? input.value : '';
      }
      var folders = value('folders').split(/[,，]/).map(function (item) {
        return item.trim();
      }).filter(function (item) {
        return item !== '';
      });
      return {
        email: value('email').trim(),
        password: value('password'),
        host: value('host').trim(),
        port: Number(value('port')),
        folders: folders,
        name: value('name').trim()
      };
    });

    return {
      telegram: {
        token: $('setTelegramToken').value.trim(),
        chatId: $('setChatId').value.trim(),
        junkChatId: $('setJunkChatId').value.trim()
      },
      general: {
        language: $('setLanguage').value,
        timeZone: $('setTimeZone').value.trim(),
        maxEmailChars: Number($('setMaxEmailChars').value),
        maxEmailBytes: Number($('setMaxEmailBytes').value),
        maxMessagesPerRun: Number($('setMaxMessagesPerRun').value),
        initialSync: $('setInitialSync').value,
        loginNotify: $('setLoginNotify').checked,
        dedupe: $('setDedupe').checked,
        dryRun: $('setDryRun').checked
      },
      mailboxes: mailboxes
    };
  }

  async function saveSettings() {
    if (state.busy) return;
    if (!state.settings || state.settings.settingsKeyConfigured !== true) {
      toast('SETTINGS_KEY 未配置，无法保存设置。', 'error');
      return;
    }
    var button = $('saveSettingsBtn');
    var previousText = button.textContent;
    setBusy(true);
    button.disabled = true;
    button.textContent = '保存中…';
    try {
      await api('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectSettings())
      });
      toast('设置已保存，立即生效。', 'ok');
      await loadStatus(true);
      var data = await api('/api/settings');
      state.settings = data;
      renderSettings(data);
    } catch (error) {
      if (error.status === 401) {
        state.token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        showLogin('ADMIN_TOKEN 无效，请重新输入。');
      } else {
        $('settingsBanner').textContent = '保存失败：' + error.message;
        $('settingsBanner').classList.add('error');
        $('settingsBanner').classList.remove('hidden');
        toast('保存失败：' + error.message, 'error');
      }
    } finally {
      setBusy(false);
      button.disabled = !(state.settings && state.settings.settingsKeyConfigured === true);
      button.textContent = previousText;
    }
  }

  async function resetSettings() {
    if (state.busy) return;
    if (!window.confirm('确定删除 KV 中的网页设置，恢复为 Cloudflare 环境变量配置吗？')) {
      return;
    }
    setBusy(true);
    try {
      await api('/api/settings', { method: 'DELETE' });
      toast('已恢复环境变量配置。', 'ok');
      await loadStatus(true);
      var data = await api('/api/settings');
      state.settings = data;
      renderSettings(data);
    } catch (error) {
      if (error.status === 401) {
        state.token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        showLogin('ADMIN_TOKEN 无效，请重新输入。');
      } else {
        $('settingsBanner').textContent = '恢复失败：' + error.message;
        $('settingsBanner').classList.add('error');
        $('settingsBanner').classList.remove('hidden');
        toast('恢复失败：' + error.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  function renumberMailboxes() {
    var cards = document.querySelectorAll('.mailbox-card');
    Array.prototype.forEach.call(cards, function (card, index) {
      var title = card.querySelector('.mailbox-title');
      if (title) title.textContent = '邮箱 ' + (index + 1);
    });
  }

  function addMailbox() {
    var list = $('mailboxList');
    if (!list) return;
    var empty = list.querySelector('.empty');
    if (empty) list.innerHTML = '';
    var index = list.querySelectorAll('.mailbox-card').length;
    list.insertAdjacentHTML('beforeend', mailboxEditorHtml({
      email: '',
      host: 'imap.gmail.com',
      port: 993,
      folders: [],
      passwordConfigured: false
    }, index));
    renumberMailboxes();
  }

  function backToDashboard() {
    showDashboard();
    loadStatus(true);
  }

  $('loginForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = $('tokenInput');
    var token = input.value.trim();
    if (!token) {
      $('loginError').textContent = '请输入 ADMIN_TOKEN。';
      return;
    }
    state.token = token;
    sessionStorage.setItem(TOKEN_KEY, token);
    $('loginError').textContent = '';
    loadStatus(false);
  });

  $('refreshBtn').addEventListener('click', function () {
    loadStatus(false);
  });

  $('runBtn').addEventListener('click', runNow);
  $('testBtn').addEventListener('click', sendTest);
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsBackBtn').addEventListener('click', backToDashboard);
  $('settingsBackBtn2').addEventListener('click', backToDashboard);
  $('saveSettingsBtn').addEventListener('click', saveSettings);
  $('resetSettingsBtn').addEventListener('click', resetSettings);

  $('settingsForm').addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    if (target.closest('#addMailboxBtn')) {
      addMailbox();
      return;
    }
    var remove = target.closest('.remove-mailbox');
    if (remove) {
      var card = remove.closest('.mailbox-card');
      if (card && card.parentNode) {
        card.parentNode.removeChild(card);
        renumberMailboxes();
      }
    }
  });

  $('logoutBtn').addEventListener('click', function () {
    state.token = '';
    state.status = null;
    sessionStorage.removeItem(TOKEN_KEY);
    $('tokenInput').value = '';
    showLogin('');
    setChip('未连接', 'muted');
  });

  loadHealth();
  if (state.token) {
    showDashboard();
    $('accounts').innerHTML = '<div class="panel empty">正在读取运行状态…</div>';
    loadStatus(false);
  } else {
    showLogin('');
  }

  setInterval(function () {
    if (state.token && !state.busy && document.visibilityState === 'visible') {
      loadStatus(true);
    }
  }, 30000);
})();
</script>
</body>
</html>`;
}
