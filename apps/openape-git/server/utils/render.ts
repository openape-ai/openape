import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import { codeToHtml } from 'shiki'

// Server-side rendering for the browse endpoint: README/markdown via
// marked + a strict sanitize-html allowlist (repo content is untrusted —
// raw HTML like `<img onerror=…>` must never reach the DOM), code via shiki.
// The allowlist mirrors plans.openape.ai's hardened renderer.

marked.setOptions({ gfm: true })

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'ul', 'ol', 'li',
    'blockquote',
    'code', 'pre',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'strong', 'em', 'del', 's', 'sup', 'sub',
    'a', 'img',
    'div', 'span', 'section', 'input',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    // GFM tables emit alignment via style="text-align:…"; keep only that.
    td: ['style'],
    th: ['style'],
    // GFM task lists render as disabled checkboxes.
    input: ['type', 'checked', 'disabled'],
  },
  allowedStyles: {
    '*': { 'text-align': [/^(left|right|center)$/] },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
  },
}

export function renderMarkdown(src: string): string {
  const html = marked.parse(src) as string
  return sanitizeHtml(html, SANITIZE_OPTIONS)
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  try {
    return await codeToHtml(code, { lang, theme: 'github-dark-default' })
  }
  catch {
    // Unknown language or grammar failure — fall back to plain text.
    return await codeToHtml(code, { lang: 'text', theme: 'github-dark-default' })
  }
}
