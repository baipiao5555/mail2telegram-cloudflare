import { parseDocument } from 'htmlparser2';
import { escapeHtml, htmlToText, telegramHtmlToPlain } from './util';

interface DomNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
}

interface RenderState {
  remaining: number;
  truncated: boolean;
}

const SKIP_TAGS = new Set([
  'script',
  'style',
  'head',
  'title',
  'noscript',
  'iframe',
  'svg',
  'object',
  'video',
  'audio',
  'canvas',
  'template',
  'meta',
  'link',
]);

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'tr',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'ul',
  'ol',
  'dl',
  'dt',
  'dd',
  'form',
  'fieldset',
]);

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function safeLink(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
  } catch {
    // Relative or malformed links are rendered as text.
  }
  return null;
}

function takeText(text: string, state: RenderState): string {
  if (state.remaining <= 0) {
    state.truncated = true;
    return '';
  }
  if (text.length <= state.remaining) {
    state.remaining -= text.length;
    return text;
  }
  const cut = text.slice(0, state.remaining);
  state.remaining = 0;
  state.truncated = true;
  return `${cut}...`;
}

function textOnly(nodes: DomNode[], state: RenderState): string {
  let output = '';
  for (const node of nodes) {
    if (state.remaining <= 0) {
      state.truncated = true;
      break;
    }
    if (node.type === 'text') {
      output += takeText(node.data ?? '', state);
      continue;
    }
    const name = (node.name ?? '').toLowerCase();
    if (name === 'br') {
      output += takeText('\n', state);
      continue;
    }
    if (name === 'img') {
      const alt = node.attribs?.alt?.trim();
      if (alt) {
        output += takeText(alt, state);
      }
      continue;
    }
    if (node.children) {
      output += textOnly(node.children, state);
    }
  }
  return output;
}

function wrap(tag: string, children: DomNode[], state: RenderState): string {
  const inner = renderNodes(children, state);
  return inner.trim() ? `<${tag}>${inner}</${tag}>` : '';
}

function block(children: DomNode[], state: RenderState): string {
  const inner = renderNodes(children, state);
  return inner.trim() ? `${inner}\n\n` : '';
}

function renderElement(node: DomNode, state: RenderState): string {
  const name = (node.name ?? '').toLowerCase();
  if (SKIP_TAGS.has(name)) {
    return '';
  }
  const children = node.children ?? [];

  switch (name) {
    case 'br':
      return takeText('\n', state);
    case 'hr':
      return takeText('\n---\n', state);
    case 'img': {
      const alt = node.attribs?.alt?.trim();
      return alt ? escapeHtml(takeText(alt, state)) : '';
    }
    case 'a': {
      const inner = renderNodes(children, state);
      const href = node.attribs?.href;
      const url = href ? safeLink(href) : null;
      if (!url) {
        return inner;
      }
      const label = inner.trim() ? inner : escapeHtml(takeText(url, state));
      return `<a href="${escapeAttr(url)}">${label}</a>`;
    }
    case 'pre': {
      const text = textOnly(children, state);
      return text.trim() ? `<pre>${escapeHtml(text)}</pre>` : '';
    }
    case 'code': {
      const text = textOnly(children, state);
      return text.trim() ? `<code>${escapeHtml(text)}</code>` : '';
    }
    case 'b':
    case 'strong':
      return wrap('b', children, state);
    case 'i':
    case 'em':
      return wrap('i', children, state);
    case 'u':
    case 'ins':
      return wrap('u', children, state);
    case 's':
    case 'strike':
    case 'del':
      return wrap('s', children, state);
    case 'blockquote':
      return wrap('blockquote', children, state);
    case 'li': {
      const inner = renderNodes(children, state).trim();
      return inner ? `• ${inner}\n` : '';
    }
    case 'td':
    case 'th':
      return `${renderNodes(children, state)} `;
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const inner = renderNodes(children, state);
      return inner.trim() ? `<b>${inner}</b>\n\n` : '';
    }
    default:
      if (BLOCK_TAGS.has(name)) {
        return block(children, state);
      }
      return renderNodes(children, state);
  }
}

function renderNodes(nodes: DomNode[], state: RenderState): string {
  let output = '';
  for (const node of nodes) {
    if (state.remaining <= 0) {
      state.truncated = true;
      break;
    }
    if (node.type === 'text') {
      output += escapeHtml(takeText(node.data ?? '', state));
      continue;
    }
    if (node.type === 'tag') {
      output += renderElement(node, state);
    }
  }
  return output;
}

function normalizeRendered(html: string): string {
  let inPre = 0;
  const normalized = html.replace(
    /(<[^>]+>)|([^<]+)/g,
    (match: string, tag: string | undefined, text: string | undefined) => {
      if (tag) {
        const lower = tag.toLowerCase();
        if (lower.startsWith('<pre')) {
          inPre += 1;
        } else if (lower.startsWith('</pre')) {
          inPre = Math.max(0, inPre - 1);
        }
        return tag;
      }
      if (inPre) {
        return text ?? '';
      }
      return (text ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\t\f\v\u00a0 ]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n');
    },
  );
  return normalized.replace(/\n{3,}/g, '\n\n').trim();
}

function normalizePlain(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v\u00a0 ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface RenderedHtml {
  html: string;
  text: string;
  truncated: boolean;
}

/**
 * Converts an email HTML body to the small, safe subset of HTML that Telegram
 * accepts. Text is escaped, links are restricted to http/https, and scripts,
 * styles, and other unsafe/irrelevant elements are dropped.
 */
export function renderTelegramHtml(html: string, maxChars = 20_000): RenderedHtml {
  const limited = html.slice(0, 1_000_000);
  try {
    const doc = parseDocument(limited, { decodeEntities: true });
    const state: RenderState = { remaining: Math.max(1, maxChars), truncated: false };
    const rendered = normalizeRendered(
      renderNodes(doc.children as unknown as DomNode[], state),
    );
    const text = normalizePlain(telegramHtmlToPlain(rendered));
    return { html: rendered, text, truncated: state.truncated };
  } catch {
    const text = normalizePlain(htmlToText(limited)).slice(0, Math.max(1, maxChars));
    return { html: escapeHtml(text), text, truncated: text.length >= maxChars };
  }
}
