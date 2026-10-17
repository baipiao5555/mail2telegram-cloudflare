# Mail2Telegram for Cloudflare Workers

把 [Heavrnl/mail2telegram](https://github.com/Heavrnl/mail2telegram) 从「Python + IMAP IDLE 常驻进程」改造成可以在 **Cloudflare Workers** 上部署的版本：

- 用 **Cron Trigger** 调度；支持 IDLE 实时窗口监听或传统轮询
- 用 **KV** 保存每个邮箱、每个文件夹的 UID 游标、登录通知状态、去重记录和运行状态
- 用 **Telegram Bot API** 转发邮件，保留原项目的 HTML 消息格式
- 不需要服务器、Docker，也不需要长期在线的进程

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/baipiao5555/mail2telegram-cloudflare)

> 点击按钮即可一键部署：登录 Cloudflare、填入 Telegram Token、chat id、邮箱 JSON 和管理 token，KV namespace 会自动创建。

> 本项目是原项目的衍生作品，遵循 GPL-3.0 许可证，详见 [LICENSE](./LICENSE) 和 [NOTICE](./NOTICE)。

## 功能

- 同时监控多个邮箱账号
- IMAP IDLE 实时监听：在每次 Cron 调用内保持连接，新邮件到达立即转发（可配置窗口）
- 自动监控 `INBOX`，并自动发现 `Junk` / `Spam` / `垃圾邮件` 文件夹
- 垃圾邮件可以转发到单独的 Telegram chat
- HTML 邮件渲染为 Telegram 富文本（加粗、链接、列表、代码块、引用），自动清理脚本和样式
- 自动提取验证码并推送到 SyncClipboard WebDAV，兼容 Fcitx5-SyncClipboard
- 支持 Gmail 应用密码、QQ 邮箱授权码等标准 IMAP 登录方式
- 自动识别转发邮件，显示原始收件人和原始发件人
- 首次运行可跳过历史邮件，或只转发每个文件夹最新的一封
- 邮件过大时只发送提醒，不下载正文
- 用 Message-ID 去重，尽量避免重复通知
- Telegram 消息自动分片、转义、429/5xx 重试、HTML 解析失败时退化为纯文本
- 内置可视化管理控制台，可查看邮箱/文件夹状态并手动触发运行
- 完整网页设置：邮箱、Telegram、监听模式、语言/时区/同步策略/大小限制都可以在控制台修改，配置加密存入 KV
- 提供 `/health`、`/status`、`/run`、`/telegram/test` 管理端点

![控制台](docs/dashboard.png)

## 与 Python 版的区别

| Python 版 | 本项目 |
| --- | --- |
| 常驻进程 + IMAP IDLE，实时推送 | Cron 调度 + IDLE 窗口，窗口内实时；窗口之间由下一次 Cron 补齐 |
| `config.py` | Wrangler secrets / vars |
| 本地日志文件 | Workers Logs / `wrangler tail` |
| 断线重连、线程模型 | 每次运行重新连接，失败后下次 Cron 重试 |
| 验证码提取扩展（EVC） | 已内置：多语言正则提取 + WebDAV/SyncClipboard 推送 |
| 附件 | 只通知正文，不转发附件 |

Cloudflare Workers 无法无限期保持一条 IMAP 连接：单次 Cron 调用最多约 15 分钟。因此 IDLE 模式采用「每次 Cron 保持一段 IDLE 连接」的方式，窗口内新邮件即时推送，窗口之间由下一次 Cron 补齐。默认窗口 40 秒，适合每分钟 Cron；如果改成每 5 分钟或 15 分钟 Cron，可以把窗口调到 240–780 秒，减少重连。

## 架构

```text
Cron Trigger (每分钟)
        │
        ▼
Cloudflare Worker ──TLS/993──▶ IMAP 服务器
        │                         ├─ LIST / SELECT
        │                         ├─ UID SEARCH
        │                         └─ UID FETCH (BODY.PEEK[])
        │
        ├──KV──▶ cursor:<邮箱>:<文件夹>   已处理到哪个 UID
        ├──KV──▶ seen:<邮箱>:<hash>       Message-ID 去重（7 天）
        ├──KV──▶ login:<邮箱>             登录成功通知只发一次
        └──KV──▶ status:<邮箱>            最近运行状态
        │
        ▼
Telegram Bot API (sendMessage)
```

## 前置条件

1. Cloudflare 账号
2. **建议使用 Workers Paid 计划**。免费计划每次 Cron 只有 10ms CPU，TLS 握手、MIME 解析很容易超限；Paid 计划默认 30 秒 CPU。
3. 一个 KV namespace（使用一键部署按钮时会自动创建；手动/CLI 部署需要自己创建）
4. 邮箱已开启 IMAP，并准备好应用密码 / 授权码：
   - Gmail：开启 IMAP，并按 [Google 文档](https://support.google.com/mail/answer/185833?hl=zh-Hans) 创建应用密码
   - QQ 邮箱：设置中开启 IMAP，使用授权码而不是登录密码
   - Outlook：与原项目一样，由于微软调整了连接方式，暂不支持；可把邮件转发到本项目使用的邮箱
5. Telegram Bot Token 和 chat id
6. 本地安装 Node.js 22+（仅部署和本地开发需要）

## 一键部署（推荐）

1. 点击 README 顶部的 **Deploy to Cloudflare** 按钮。
2. 登录 Cloudflare，授权 GitHub。Cloudflare 会把本仓库复制到你的 GitHub 账号下。
3. 在配置页填写以下 secrets（值来自 `.dev.vars.example` 的提示）：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `MAILBOXES`（JSON 数组，格式见下文）
   - `ADMIN_TOKEN`
   - `SETTINGS_KEY`（32 字节随机密钥，用于加密网页设置；运行 `openssl rand -hex 32`）

   > 务必把所有占位值替换成真实值，尤其是 `MAILBOXES` 里的邮箱和应用密码。
4. 点击 **Deploy**。Cloudflare 会自动创建 KV namespace、更新绑定并部署 Worker。
5. 打开 `https://<你的-worker>.workers.dev/health`，确认 `configured: true`。
6. 打开 Worker 根地址，输入 `ADMIN_TOKEN` 进入控制台，查看状态或手动运行；点击「设置」可以在网页里修改所有配置。
7. 可选：在 Cloudflare Dashboard → Worker → **Settings → Variables and Secrets** 中添加 `TELEGRAM_JUNK_CHAT_ID`，用于垃圾邮件分流。

说明：

- Deploy to Cloudflare 按钮要求源仓库是 **public**。
- 部署流程会读取 `.dev.vars.example` 中的 secret 名称，并让你填写真实值；不要把真实值提交到仓库。
- Cloudflare 会为你的副本建立 Workers Builds，之后往这个副本仓库推送代码会自动重新部署。

## 手动部署（CLI）

### 1. 安装依赖并登录

```bash
cd mail2telegram-cloudflare
npm install
npx wrangler login
```

### 2. 创建 KV namespace

```bash
npx wrangler kv namespace create MAIL2TG_KV
```

把命令输出的 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "MAIL2TG_KV"
id = "命令输出的 id"
```

本地 `wrangler dev` 使用本地模拟 KV，不需要 preview namespace。

### 3. 配置邮箱

邮箱列表通过 secret `MAILBOXES` 提供，JSON 数组格式：

```json
[
  {
    "email": "you@gmail.com",
    "password": "Gmail 应用密码",
    "host": "imap.gmail.com",
    "port": 993
  },
  {
    "email": "you@qq.com",
    "password": "QQ 邮箱授权码",
    "host": "imap.qq.com",
    "port": 993,
    "folders": ["INBOX", "Junk"]
  }
]
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `email` | 是 | 登录邮箱，同时作为 KV 中的账号 ID |
| `password` | 是 | 应用密码 / 授权码，保留首尾空格 |
| `host` | 是 | IMAP 服务器，只允许公网域名或公网 IP |
| `port` | 否 | 默认 `993`，必须使用隐式 TLS；端口 25 被 Workers 禁止 |
| `folders` | 否 | 手动指定文件夹。省略时自动使用 `INBOX` + 自动发现的垃圾文件夹 |
| `name` | 否 | 显示名称，会出现在 `/status` 返回结果中 |

也兼容原 `config.py` 的大写字段：

```json
[
  {
    "EMAIL": "you@gmail.com",
    "PASSWORD": "app-password",
    "IMAP_SERVER": "imap.gmail.com",
    "IMAP_SERVER_PORT": 993
  }
]
```

写入 secret：

```bash
npx wrangler secret put MAILBOXES
```

然后粘贴上面的一行 JSON（或格式化后的 JSON 也可以）。

> 文件夹名称必须是 IMAP 服务器返回的准确名称，区分大小写（`INBOX` 除外）。如果自动发现垃圾文件夹失败，用 `folders` 手动指定。除 `INBOX` 以外的文件夹都会被当作垃圾邮件，转发到 `TELEGRAM_JUNK_CHAT_ID`；未配置该 chat 时只推进游标、不转发。

### 4. 配置 Telegram 和密钥

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put SETTINGS_KEY
```

`SETTINGS_KEY` 用 `openssl rand -hex 32` 生成。它只用于加密网页设置；设置后可以在控制台里修改邮箱、Telegram 和通用参数，不需要再动 Cloudflare secrets。

`TELEGRAM_CHAT_ID` 可以直接编辑 `wrangler.toml` 的 `[vars]`，也可以作为 secret 写入：

```bash
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TELEGRAM_JUNK_CHAT_ID   # 可选
```

获取 chat id：给机器人发一条消息，然后访问

```text
https://api.telegram.org/bot<你的BOT_TOKEN>/getUpdates
```

在返回的 JSON 中找到 `message.chat.id`。群组 ID 通常是负数。

`ADMIN_TOKEN` 用于保护 `/status`、`/run`、`/telegram/test` 和控制台，建议用 32 位以上随机字符串。未设置时这些端点会返回 503。

### 5. 部署

```bash
npm run deploy
```

部署完成后 Cron Trigger 会自动生效。验证：

```bash
curl https://<你的-worker>.workers.dev/health
```

返回 `configured: true` 表示基础配置完整。浏览器打开 Worker 根地址并输入 `ADMIN_TOKEN`，可以在控制台里查看状态、执行操作，并在「设置」页修改所有配置。

手动触发一次并查看结果：

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "https://<你的-worker>.workers.dev/run"
```

发送一条 Telegram 测试消息：

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "https://<你的-worker>.workers.dev/telegram/test"
```

### 6. 调整轮询频率

`wrangler.toml` 默认每分钟轮询一次：

```toml
[triggers]
crons = ["* * * * *"]
```

如果邮箱较多，或服务商限制登录频率，可以改成每 5 分钟：

```toml
crons = ["*/5 * * * *"]
```

修改后重新 `npm run deploy`。

## 配置项

在 `wrangler.toml` 的 `[vars]`、Wrangler secrets 或控制台的「设置」页中设置。

除 `ADMIN_TOKEN` 和 `SETTINGS_KEY` 外，其余配置都可以在控制台里修改。保存后配置会加密写入 KV，并优先于环境变量。

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | 无 | **secret**，Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | 无 | 普通邮件转发目标 |
| `TELEGRAM_JUNK_CHAT_ID` | 空 | 垃圾邮件转发目标；为空则跳过垃圾邮件 |
| `MAILBOXES` | 无 | **secret**，邮箱 JSON 数组 |
| `ADMIN_TOKEN` | 空 | **secret**，控制台和管理接口的 Bearer token；为空时禁用管理接口；只能在 Cloudflare 修改 |
| `SETTINGS_KEY` | 空 | **secret**，网页设置的 AES-GCM 加密主密钥（32 字节）；只能在 Cloudflare 修改 |
| `LANGUAGE` | `Chinese` | `Chinese` 或 `English` |
| `TIMEZONE` | `Asia/Shanghai` | 邮件日期显示的 IANA 时区 |
| `MAX_EMAIL_CHARS` | `3000` | 正文最多保留字符数（100–20000） |
| `MAX_EMAIL_BYTES` | `10485760` | 单封邮件最大字节数（10 MB）；超过只发提醒 |
| `MAX_MESSAGES_PER_RUN` | `20` | 每个文件夹每次最多处理多少封新邮件 |
| `INITIAL_SYNC` | `skip` | `skip` 跳过历史邮件；`latest` 转发每个文件夹最新一封 |
| `LOGIN_NOTIFY` | `true` | 每个邮箱首次登录成功时发送一次通知 |
| `DEDUPE` | `true` | 按 Message-ID 去重，保留 7 天 |
| `DRY_RUN` | `false` | 只记录日志、不调用 Telegram；**仍会推进游标** |
| `LISTEN_MODE` | `poll` | `poll` 轮询或 `idle` IDLE 窗口监听 |
| `IDLE_WINDOW_SECONDS` | `40` | IDLE 窗口秒数（10–780），必须小于 Cron 间隔 |
| `ENABLE_EVC` | `false` | 可选：启用验证码提取；网页设置里也可以开 |
| `WEBDAV_URL` | 空 | 可选：r2-webdav 根地址（公网 http/https） |
| `WEBDAV_USERNAME` | 空 | 可选：WebDAV 用户名 |
| `WEBDAV_PASSWORD` | 空 | 可选：WebDAV 密码（建议用 secret） |
| `WEBDAV_PATH` | `SyncClipboard.json` | 可选：写入的 JSON 路径 |

## HTTP 端点

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 无 | 健康检查，不泄露邮箱和密钥 |
| GET | `/`、`/dashboard` | 页面公开，数据需 Bearer | 可视化管理控制台 |
| GET | `/status` | Bearer | 查看每个邮箱最近运行状态、游标和错误 |
| GET/PUT/DELETE | `/api/settings` | Bearer | 读取、保存、恢复网页设置（GET 只返回脱敏信息） |
| POST | `/run` | Bearer | 立即轮询；可加 `?mailbox=you@gmail.com` 只跑一个账号 |
| POST | `/telegram/test` | Bearer | 发送测试消息 |

鉴权格式：

```text
Authorization: Bearer <ADMIN_TOKEN>
```

## 控制台

浏览器打开 Worker 根地址，输入部署时设置的 `ADMIN_TOKEN` 即可进入控制台：

- 查看每个邮箱、每个文件夹的 UID、UIDVALIDITY 和最近转发时间
- 查看最近运行时间、配置和错误信息
- 一键执行「刷新状态」「立即运行」「发送测试消息」
- 「设置」页可以增删邮箱、修改 Telegram、语言/时区/同步策略/限制/DRY_RUN
- Token 只保存在当前标签页的 `sessionStorage`，关闭页面后自动清除
- 未登录时页面不会加载任何邮箱数据；所有数据接口仍然要求 Bearer token
- 页面带 CSP、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer` 等安全响应头

![控制台](docs/dashboard.png)

### 网页设置

首次使用网页设置前，需要一次性在 Cloudflare 添加主密钥：

1. 生成 32 字节随机密钥：

   ```bash
   openssl rand -hex 32
   ```

2. 打开 Cloudflare Dashboard → Worker (`mail2telegram-bot`) → **Settings → Variables and Secrets**
3. 添加 **Secret**，名称 `SETTINGS_KEY`，值为上一步生成的 64 位十六进制字符串
4. 刷新控制台，进入「设置」，修改后点击「保存设置」

![设置页](docs/settings.png)

说明：

- 配置使用 **AES-GCM** 加密后存到 KV；KV 里不会出现邮箱密码或 Bot Token 明文
- `GET /api/settings` 只返回“是否已配置”，不会回显已保存的密码或 Token
- 邮箱密码和 Bot Token 输入框留空表示保持原值；新增邮箱必须填写密码
- 保存后立即生效，不需要重新部署
- KV 配置优先于 Cloudflare 环境变量；点击「恢复环境变量配置」会删除 KV 配置，回退到环境变量
- 修改 `SETTINGS_KEY` 会导致旧配置无法解密；请先正确恢复，或用新的密钥重新保存
- `ADMIN_TOKEN` 和 `SETTINGS_KEY` 仍然只能在 Cloudflare 修改，避免网页误操作把自己锁在外面

## 行为说明

### 首次运行

- `INITIAL_SYNC=skip`（默认）：记录每个文件夹当前最大 UID，不转发已有邮件。
- `INITIAL_SYNC=latest`：转发每个文件夹最新的一封，然后记录游标。

### IDLE 监听模式

把 `LISTEN_MODE` 设为 `idle`（或在控制台「设置 → 监听模式」选择 IDLE）后：

1. 每次 Cron 调用会连接每个邮箱/文件夹，先处理一次新邮件
2. 然后进入 IMAP `IDLE`，服务器推送 `EXISTS` 时立即抓取并转发
3. 到达 `IDLE_WINDOW_SECONDS` 后发送 `DONE`，关闭连接；下一次 Cron 再继续

窗口必须小于 Cron 间隔：

| Cron | 建议窗口 |
| --- | --- |
| `* * * * *`（每分钟） | 30–40 秒 |
| `*/5 * * * *`（每 5 分钟） | 240–270 秒 |
| `*/15 * * * *`（每 15 分钟） | 720–780 秒 |

如果服务器不广告 `IDLE`，会退化为窗口内每 20 秒轮询一次。用户较多/文件夹较多时会同时占用多个 TCP 连接，建议控制账号数量。

### UIDVALIDITY 变化

IMAP 服务器重建邮箱时会改变 `UIDVALIDITY`。检测到变化后，本项目会重新建立基线，避免把旧邮件当成新邮件重复发送。

### 游标与失败重试

每成功处理一封邮件后都会把游标写入 KV。如果 Telegram 发送失败，该邮件的游标不会前进，下次 Cron 会从这封邮件重试。这样不会丢信，但如果 Telegram 配置长期错误，会阻塞该文件夹的后续邮件，`/status` 会显示错误。

每个邮箱的连接和拉取时间有 60 秒预算。如果一轮运行超过 Cron 间隔，Cloudflare 可能并发触发下一轮，造成重复通知；账号较多或网络较慢时，把 Cron 调整为 5 分钟。手动调用 `/run` 时也应避免与 Cron 同时执行。

### 去重与 KV 一致性

KV 是最终一致的，极少数情况下不同地区的 Cron 可能读到旧游标，导致重复通知。Message-ID 去重可以降低这种情况。IMAP 游标是准确性的最终来源。

### 大邮件与附件

超过 `MAX_EMAIL_BYTES` 的邮件只抓取 `FROM / SUBJECT / DATE / MESSAGE-ID` 等头信息并发送提醒。附件不会被下载或转发，只转发正文。

### HTML 邮件渲染

HTML 邮件会转换成 Telegram 支持的富文本：

- `<b>` / `<strong>` → 加粗
- `<i>` / `<em>` → 斜体
- `<u>` / `<ins>` → 下划线
- `<s>` / `<strike>` / `<del>` → 删除线
- `<a href>` → 链接（只保留 http/https）
- `<ul>` / `<ol>` / `<li>` → 项目符号
- `<pre>` / `<code>` → 代码块
- `<blockquote>` → 引用

`script`、`style`、`iframe`、`svg` 等标签会被移除；文本节点和链接属性都会转义，邮件内容无法注入 Telegram 标记。超长正文会退回纯文本，避免 HTML 标签被分片截断。

### 验证码 → SyncClipboard WebDAV

在控制台「设置」页启用「提取验证码并推送到 WebDAV」，填写：

- **WebDAV URL**：r2-webdav 根地址，例如 `https://webdav.example.com`
- **用户名 / 密码**：r2-webdav 的 `USERNAME` / `PASSWORD`
- **文件路径**：默认 `SyncClipboard.json`

提取逻辑：在邮件主题和正文中查找多语言关键词附近的 4–8 位数字或字母数字组合（至少包含一个数字），支持：

- 简体中文：验证码、校验码、动态码、确认码、一次性密码、一次性令牌、安全码、登录码、验证 ID
- 繁体中文：驗證碼、校驗碼、動態碼、確認碼、一次性密碼、一次性令牌、安全碼、登入碼、驗證 ID
- 英文：verification code、verify code、confirmation code、security code、one-time code/password/passcode/token、OTP、TOTP、PIN、code
- 日文：認証コード、確認コード、検証コード、ワンタイムパスワード/コード、セキュリティコード、パスコード、暗証番号
- 俄文：код подтверждения、проверочный код、одноразовый код/пароль、код безопасности、пин-код
- 韩文：인증 코드、확인 코드、일회용 비밀번호/코드
- 德/法/西/葡：bestätigungscode、code de vérification、código de verificación、código de verificação

匹配到后 PUT 到：

```text
<WebDAV URL>/<文件路径>
```

JSON 格式兼容 Fcitx5-SyncClipboard 和 SyncClipboard：

```json
{
  "type": "Text",
  "text": "123456",
  "hash": "8D969EEF6ECAD3C29A3A629280E686CF0C3F5D5A86AFF3CA12020C923ADC6C92",
  "hasData": false,
  "dataName": "",
  "size": 6
}
```

- `hash`：验证码 UTF-8 文本的 SHA-256 大写十六进制
- `size`：UTF-8 字节数
- 邮件仍会正常转发到 Telegram；WebDAV 推送失败只记录日志，不会阻断邮件转发
- WebDAV 只允许公网 `http/https`，拒绝 localhost、私有/保留地址和重定向
- 用户名和密码保存在加密配置中，不会回显

r2-webdav 部署：

```bash
git clone https://github.com/7hgyk/r2-webdav
cd r2-webdav
# 修改 wrangler.toml 里的 R2 bucket
npx wrangler secret put USERNAME
npx wrangler secret put PASSWORD
npm run deploy
```

然后在 Fcitx5-SyncClipboard 中把 WebDAV 地址填成同一个根地址，使用相同的用户名和密码，它会读取同一个 `SyncClipboard.json`。

> 环境变量方式也支持：`ENABLE_EVC=true`、`WEBDAV_URL`、`WEBDAV_USERNAME`、`WEBDAV_PASSWORD`、`WEBDAV_PATH`。保存过网页设置后，KV 配置优先。

## 本地开发

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入测试配置
npm run dev
```

`.dev.vars` 已被 `.gitignore` 忽略，不要提交真实凭据。

本地触发 Cron：

```bash
npx wrangler dev --test-scheduled
curl "http://127.0.0.1:8787/__scheduled?cron=*%2F1+*+*+*+*"
```

本地 `wrangler dev` 支持 `cloudflare:sockets` 出站 TCP，因此可以连接真实 IMAP 服务器测试（请使用测试账号）。

## 测试

```bash
npm test
npm run typecheck
npm run deploy -- --dry-run
```

测试包括：

- IMAP 响应/literal 解析、IDLE 进入/退出与超时
- 真实 IMAP 客户端流程（对本地假 IMAP 服务器）
- 首次基线、增量拉取、UIDVALIDITY 重置、垃圾邮件分流、每轮上限、大邮件提醒、去重
- 邮件解码、HTML → Telegram 富文本渲染与安全过滤
- 多语言验证码提取（中日英俄韩德法西葡、简繁中文）
- WebDAV 推送：URL/路径、Basic Auth、SyncClipboard JSON、SHA-256、重定向和私网拒绝
- Telegram 分片、429 重试、HTML 退化
- 配置校验、私网地址拒绝、HTTP 鉴权、加密设置存储

实现阶段还在本机 Workerd 中对真实 Gmail IMAP 做了 TLS 握手和 capability 解析验证（不涉及账号凭据）。

## 安全说明

- IMAP 只允许隐式 TLS（默认 993），不支持明文连接。
- 配置中的 IMAP host 会在建立连接前校验，拒绝 localhost、环回、私有、链路本地、保留地址和保留域名；连接建立后还会检查远端 IP。
- Telegram 请求固定为 `https://api.telegram.org`，并禁止重定向。
- 密码、Bot Token 只通过 Wrangler secrets 或加密后的 KV 配置保存，不写入日志；错误信息会过滤 Token。
- 网页设置使用 AES-GCM 加密后存入 KV，主密钥 `SETTINGS_KEY` 只保存在 Worker secret 中；设置接口不会回显密码或 Token。
- HTML 邮件会先清洗再渲染，只保留 Telegram 支持的标签，文本节点和链接属性均转义；超长正文退回纯文本。
- WebDAV 请求前校验 URL，只允许公网 http/https，拒绝 localhost、环回、私有/保留地址和重定向；Basic 凭据不写入日志。
- `/status`、`/run`、`/telegram/test`、`/api/settings` 需要 `ADMIN_TOKEN`。

## 常见问题

**Gmail 登录失败？**
确认已开启 IMAP，并且使用的是应用密码；普通账号密码不能用于 IMAP。

**QQ 邮箱登录失败？**
需要使用授权码，并确认已开启 IMAP 服务。

**没有收到「成功登录邮箱」消息？**
检查 `LOGIN_NOTIFY`、`TELEGRAM_CHAT_ID` 和 Workers 日志。登录通知只会在第一次成功登录时发送。

**垃圾邮件没转发？**
设置 `TELEGRAM_JUNK_CHAT_ID`；如果自动发现垃圾文件夹失败，用 `folders` 手动指定准确名称。

**Telegram 返回 429？**
Worker 会按 `retry_after` 重试；如果持续 429，降低轮询频率或减少账号数量。

**免费计划能用吗？**
技术上可以部署，但 Cron 每次只有 10ms CPU，TLS + IMAP + MIME 解析很可能超限。建议使用 Workers Paid。

**邮件延迟？**
Workers 没有常驻 IDLE 连接，最小轮询间隔是 1 分钟，因此通知最多延迟约 1 分钟。

## 项目结构

```text
src/
  index.ts          Cron、HTTP 路由、鉴权
  env.ts            Env 类型与配置解析
  poll.ts           轮询编排、文件夹发现、消息处理
  state.ts          KV 游标/状态/去重
  mail.ts           MIME 解析、转发识别、正文提取
  telegram.ts       Telegram 发送、分片、重试
  security.ts       host/IP 校验、Telegram URL 校验
  util.ts           HTML 转文本、时间格式化、分片等
  imap/
    client.ts       IMAP over cloudflare:sockets
    reader.ts       字节流与 literal 解析
    parser.ts       LIST/SEARCH/UIDVALIDITY 解析、mUTF-7
test/               单元测试与本地假 IMAP 集成测试
```

## 致谢

- 原项目：[Heavrnl/mail2telegram](https://github.com/Heavrnl/mail2telegram)
- 邮件解析：[postal-mime](https://github.com/postalsys/postal-mime)
- 剪贴板扩展原作者项目：[Jeric-X/SyncClipboard](https://github.com/Jeric-X/SyncClipboard)、[Heavrnl/ExtractVerificationCode](https://github.com/Heavrnl/ExtractVerificationCode)

## License

GPL-3.0，与原项目一致。见 [LICENSE](./LICENSE)。
