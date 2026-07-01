import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

// Render Markdown to HTML using marked, then sanitize with a strict allowlist.
// Plan bodies are written by humans AND agents and shown to other team members,
// so the rendered HTML is untrusted: raw HTML in the source (e.g.
// `<img src=x onerror=…>`) must never survive into the DOM. GFM is enabled and
// line breaks are honored so bodies render close to how they look in an editor.
marked.setOptions({ gfm: true, breaks: true })

// Allowlist per the plans.openape.ai HTML-hardening plan: structural + inline
// text formatting, tables, links and images only. Everything else (script,
// style, iframe/object/embed, form, all on* handlers, svg) is dropped.
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
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    // GFM tables emit alignment via style="text-align:…"; keep only that.
    td: ['style'],
    th: ['style'],
  },
  allowedStyles: {
    '*': { 'text-align': [/^(left|right|center)$/] },
  },
  // Only linkable/loadable schemes we trust. No javascript:, no data:.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  // Any a[target] gets rel=noopener noreferrer to neutralize reverse tabnabbing.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
  },
}

export function renderMarkdown(src: string): string {
  const html = marked.parse(src) as string
  return sanitizeHtml(html, SANITIZE_OPTIONS)
}
