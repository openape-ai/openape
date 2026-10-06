import { marked, Marked } from 'marked'
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

export function renderIssueMarkdown(source: string, links: Record<string, string> = {}): string {
  const parser = new Marked({ gfm: true })
  parser.use({
    walkTokens(token) {
      if ((token.type === 'link' || token.type === 'image') && links[token.href]) token.href = links[token.href]!
    },
    extensions: [{
      name: 'issueReference',
      level: 'inline',
      start: text => text.search(/(?:[\w.-]+\/[\w.-]+)?#[1-9]\d*\b/),
      tokenizer(text) {
        const match = /^(?:[\w.-]+\/[\w.-]+)?#[1-9]\d*\b/.exec(text)
        if (match && links[match[0]]) return { type: 'issueReference', raw: match[0], text: match[0], href: links[match[0]] }
      },
      renderer: token => `<a href="${token.href}">${token.text}</a>`,
    }],
  })
  return sanitizeHtml(parser.parse(source) as string, {
    ...SANITIZE_OPTIONS,
    transformTags: {
      ...SANITIZE_OPTIONS.transformTags,
      img: (_tag, attributes) => ({ tagName: 'a', attribs: { href: attributes.src ?? '', rel: 'noopener noreferrer', target: '_blank' }, text: attributes.alt || 'Image attachment' }),
    },
  })
}
