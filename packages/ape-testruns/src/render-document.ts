import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectHtml, invalid } from '@openape/report-contracts/html'
import { marked, Renderer } from 'marked'
import sanitizeHtml from 'sanitize-html'

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&#39;')
}

function safeLink(href: string | undefined): boolean {
  if (!href) return false
  if (href.startsWith('#')) return true
  try {
    const url = new URL(href)
    return url.protocol === 'https:' && !url.username && !url.password
  }
  catch { return false }
}

export function markdown(value: string | undefined): string {
  if (!value) return ''
  const renderer = new Renderer()
  renderer.html = token => escapeHtml(token.text)
  renderer.checkbox = token => token.checked ? '☑ ' : '☐ '
  renderer.image = token => `[Image reference: ${escapeHtml(token.text)}]`
  return sanitizeHtml(marked.parse(value, { async: false, renderer }) as string, {
    allowedTags: ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'code', 'pre', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'h1', 'h2', 'h3', 'h4'],
    allowedAttributes: { a: ['href', 'rel'] }, allowedSchemes: ['https'], allowProtocolRelative: false,
    transformTags: { a: (_tag, attributes) => ({ tagName: 'a', attribs: { ...(safeLink(attributes.href) ? { href: attributes.href } : {}), rel: 'noopener noreferrer' } }) },
  })
}

export function items(values: string[]): string {
  return values.length ? `<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : ''
}

export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
}

export function documentHtml(kind: 'plan' | 'test-run', title: string, content: string, metadata: Record<string, string>, source: unknown, templateDirectory = fileURLToPath(new URL('../templates', import.meta.url)), bodySlots?: Record<string, string>): string {
  const template = readFileSync(join(templateDirectory, `${kind}.html`), 'utf8')
  const [frame, body] = template.split('<!-- report-body -->')
  if (!frame || !body) invalid('Template must contain a report-body fragment')
  const fill = (value: string, values: Record<string, string>) => value.replace(/\{\{([a-zA-Z]+)\}\}/gu, (_match, key: string) => {
    if (values[key] === undefined) invalid(`Unknown template slot: ${key}`)
    return values[key]
  })
  const slots: Record<string, string> = {
    language: bodySlots?.language ?? 'en',
    banner: bodySlots?.banner ?? '', masthead: bodySlots?.masthead ?? '',
    body: bodySlots ? fill(body, bodySlots) : '',
    title: escapeHtml(title), content, styles: readFileSync(join(templateDirectory, 'document.css'), 'utf8'),
    metadata: jsonForHtml({ category: kind === 'plan' ? 'Plans' : 'Test Runs', tags: [], metadata }),
    source: `<script id="openape-${kind}-source" type="application/json">${jsonForHtml(source)}</script>`,
  }
  const html = fill(frame, slots)
  inspectHtml(html)
  return html
}

export function masthead(category: string): string {
  return `<div class="masthead"><span class="brand"><span class="brand-mark"></span>OpenApe <span>${category}</span></span></div>`
}

export function meta(values: (string | undefined)[]): string {
  return `<div class="meta">${values.filter((value): value is string => Boolean(value)).map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>`
}
