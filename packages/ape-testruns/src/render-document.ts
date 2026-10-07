import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectHtml, invalid } from '@openape/report-contracts/html'
import { marked, Renderer } from 'marked'
import sanitizeHtml from 'sanitize-html'
import { planLanguageView } from './plan-language-views'

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&#39;').replaceAll('\uFFFD', '&#xFFFD;')
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
  }).replaceAll('\uFFFD', '&#xFFFD;')
}

export function items(values: string[]): string {
  return values.length ? `<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : ''
}

export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026').replaceAll('\uFFFD', '\\ufffd')
}

export function documentHtml(kind: 'plan' | 'test-run', title: string, content: string, metadata: Record<string, string>, source: unknown, templateDirectory = fileURLToPath(new URL('../templates', import.meta.url)), bodySlots?: Record<string, string>, germanSlots?: Record<string, string>, defaultLanguage: 'de' | 'en' = 'de'): string {
  const template = readFileSync(join(templateDirectory, `${kind}.html`), 'utf8')
  const [frame, fragments] = template.split('<!-- report-body -->')
  const [body, controls] = fragments?.split('<!-- report-language-controls -->') ?? []
  if (!frame || !body) invalid('Template must contain a report-body fragment')
  const fill = (value: string, values: Record<string, string>) => value.replace(/\{\{([a-zA-Z]+)\}\}/gu, (_match, key: string) => {
    if (values[key] === undefined) invalid(`Unknown template slot: ${key}`)
    return values[key]
  })
  const sharedKeys = { evidence: '', targets: '', references: '' }
  const originalRecords = bodySlots ? `${bodySlots.evidence}${bodySlots.targets}${bodySlots.references}` : ''
  const sharedRecords = originalRecords ? `<section class="page shared-records" lang="en"><h2><span lang="de">Originalbelege</span> / <span lang="en">Original records</span></h2><p><span lang="de">Nachweise, Prüfziele und Referenzen gelten für beide Sprachen.</span> / <span lang="en">Evidence, targets and references are shared across languages.</span></p>${originalRecords}</section>` : ''
  const englishBody = bodySlots ? fill(body, { ...bodySlots, ...sharedKeys }) : ''
  const germanBody = germanSlots ? fill(body, { ...germanSlots, ...sharedKeys }) : ''
  const bilingualBody = germanSlots && bodySlots
    ? `${defaultLanguage === 'de' ? planLanguageView(germanBody, 'de') + planLanguageView(englishBody, 'en') : planLanguageView(englishBody, 'en') + planLanguageView(germanBody, 'de')}${sharedRecords}`
    : undefined
  if (germanSlots && !controls) invalid('Bilingual Plan template requires language controls')
  const initial = germanSlots && defaultLanguage === 'de' ? germanSlots : bodySlots
  const slots: Record<string, string> = {
    language: initial?.language ?? 'en',
    banner: bodySlots?.banner ?? '', masthead: bodySlots?.masthead ?? '',
    body: bilingualBody ?? (bodySlots ? fill(body, bodySlots) : ''),
    controls: germanSlots ? fill(controls!, { deChecked: defaultLanguage === 'de' ? ' checked' : '', enChecked: defaultLanguage === 'en' ? ' checked' : '' }) : '',
    title: initial?.title ?? escapeHtml(title), content, styles: readFileSync(join(templateDirectory, 'document.css'), 'utf8'),
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
  const present = values.filter((value): value is string => Boolean(value))
  return present.length ? `<div class="meta">${present.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>` : ''
}
