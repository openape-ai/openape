import { Parser } from 'htmlparser2'
import postcss from 'postcss'
import values from 'postcss-value-parser'

export const HTML_LIMIT = 20 * 1024 * 1024
export const EMBEDDED_RESOURCE_LIMIT = 8 * 1024 * 1024
export const HTML_POLICY = 'publisher-trusted-html/2'
export const RECOVERY_MS = 30 * 24 * 60 * 60 * 1000

export class ReportError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}
export function invalid(message: string): never { throw new ReportError('VALIDATION', message) }
export function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object')
  const result = value as Record<string, unknown>
  for (const key of Object.keys(result)) {
    if (!allowed.includes(key)) invalid(`Unknown field: ${key}`)
  }
  return result
}
export function label(value: unknown, maximum: number, name: string): string {
  if (typeof value !== 'string' || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) invalid(`Invalid ${name}`)
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (!normalized || [...normalized].length > maximum) invalid(`${name} must contain 1–${maximum} characters`)
  return normalized
}
export function tags(value: unknown): string[] {
  if (!Array.isArray(value)) invalid('tags must be an array')
  const result = [...new Set(value.map(item => label(item, 64, 'tag').toLowerCase()))]
  if (result.length > 20) invalid('At most 20 distinct tags are supported')
  return result
}
export function metadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('metadata must be an object')
  const entries = Object.entries(value)
  if (entries.length > 30 || Buffer.byteLength(JSON.stringify(value)) > 16384) invalid('Metadata exceeds its size limit')
  return Object.fromEntries(entries.map(([key, text]) => {
    if (!/^[a-z][a-z0-9_-]{0,31}\.[a-z][a-z0-9_.-]{0,63}$/u.test(key)) invalid(`Metadata key must be namespaced: ${key}`)
    return [key, label(text, 2048, key)]
  }))
}
export interface HtmlMetadata { title: string, language?: string, category?: string, tags: string[], metadata: Record<string, string> }
export interface HtmlPublication extends HtmlMetadata { html: string, externalImages: string[], externalLinks: string[] }

export function normalizeMetadata(value: unknown): HtmlMetadata {
  const input = object(value, ['title', 'language', 'category', 'tags', 'metadata'])
  const result: HtmlMetadata = { title: label(input.title, 300, 'title'), tags: tags(input.tags ?? []), metadata: metadata(input.metadata ?? {}) }
  if (input.category !== undefined && input.category !== null) result.category = label(input.category, 80, 'category')
  if (input.language !== undefined && input.language !== null) {
    if (typeof input.language !== 'string' || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/iu.test(input.language)) invalid('Invalid language tag')
    result.language = input.language
  }
  return result
}

export function inspectHtml(html: string, overrides: Partial<HtmlMetadata> = {}): HtmlPublication {
  if (typeof html !== 'string' || !html.trim() || Buffer.byteLength(html) > HTML_LIMIT) invalid('HTML must contain 1–20 MiB of UTF-8 content')
  if (html.includes('\u0000') || html.includes('\uFFFD')) invalid('Invalid HTML encoding')
  let title = ''; let language: string | undefined; let current = ''; let text = ''; let hasHtml = false; let blocks = 0
  let embedded: Record<string, unknown> = {}
  const externalImages = new Set<string>(); const externalLinks = new Set<string>()
  const resource = (url: string, kind: 'image' | 'font') => {
    if (url.startsWith('#')) return
    if (url.startsWith('data:')) {
      const match = /^data:([^;,]+);base64,([a-z0-9+/]*={0,2})$/iu.exec(url)
      if (!match || match[2]!.length % 4 || Buffer.from(match[2]!, 'base64').toString('base64') !== match[2]) invalid('Embedded resources must use valid base64 data URLs')
      const mime = match[1]!.toLowerCase()
      if (!(kind === 'image' ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'] : ['font/woff', 'font/woff2', 'font/ttf', 'font/otf']).includes(mime)) invalid(`Unsupported embedded ${kind}: ${mime}`)
      const bytes = Buffer.from(match[2]!, 'base64')
      if (bytes.length > EMBEDDED_RESOURCE_LIMIT) invalid('An embedded resource exceeds 8 MiB')
      const signatures: Record<string, boolean> = {
        'image/png': bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        'image/jpeg': bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
        'image/gif': ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
        'image/webp': bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
        'image/svg+xml': /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/u.test(bytes.toString('utf8')),
        'font/woff': bytes.toString('ascii', 0, 4) === 'wOFF',
        'font/woff2': bytes.toString('ascii', 0, 4) === 'wOF2',
        'font/ttf': bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])),
        'font/otf': bytes.toString('ascii', 0, 4) === 'OTTO',
      }
      if (!signatures[mime]) invalid(`Embedded resource bytes do not match ${mime}`)
      return
    }
    if (kind === 'image') {
      let parsed: URL
      try { parsed = new URL(url) }
      catch { invalid(`Embed local or relative image reference: ${url.slice(0, 100)}`) }
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) { externalImages.add(parsed.href); return }
    }
    invalid(`Embed ${kind} resources; only external HTTPS images are supported`)
  }
  const css = (source: string) => {
    let root: postcss.Root
    try { root = postcss.parse(source) }
    catch { invalid('Invalid embedded CSS') }
    root.walkAtRules((rule) => { if (rule.name.toLowerCase() === 'import') invalid('Embed stylesheets instead of using @import') })
    root.walkDecls((declaration) => {
      values(declaration.value).walk((node) => {
        if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return
        const url = values.stringify(node.nodes).trim().replace(/^(['"])(.*)\1$/su, '$2')
        resource(url, declaration.parent?.type === 'atrule' && declaration.parent.name.toLowerCase() === 'font-face' ? 'font' : 'image')
      })
    })
  }
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'html') { hasHtml = true; language = attrs.lang }
      if (['iframe', 'object', 'embed', 'base'].includes(name)) invalid(`Unsupported embedded element: ${name}`)
      if (name === 'meta' && attrs['http-equiv']) invalid('HTTP-equivalent metadata is controlled by the viewer')
      if (name === 'script' && attrs.src) invalid('Embed JavaScript; external scripts are unsupported')
      if (name === 'link' && attrs.href) invalid('Embed styles, fonts and icons instead of link resources')
      if (attrs.srcset) invalid('Use one embedded or HTTPS image src instead of srcset')
      if (attrs.style) css(`x{${attrs.style}}`)
      for (const key of ['src', 'poster', 'background', 'xlink:href']) {
        if (attrs[key]) resource(attrs[key], 'image')
      }
      if (attrs.href && name !== 'a') resource(attrs.href, 'image')
      if (name === 'a' && attrs.href && !attrs.href.startsWith('#')) {
        let url: URL
        try { url = new URL(attrs.href) }
        catch { invalid('Use fragment links or absolute HTTPS links') }
        if (url.protocol !== 'https:' || url.username || url.password) invalid('External links must use HTTPS without credentials')
        externalLinks.add(url.href)
      }
      if (name === 'title' || name === 'style') { current = name; text = '' }
      if (name === 'script' && attrs.id === 'openape-report') {
        if (attrs.type !== 'application/json' || ++blocks > 1) invalid('Use exactly one inert application/json metadata block')
        current = 'metadata'; text = ''
      }
    },
    ontext(value) { if (current) text += value },
    onclosetag(name) {
      if (current === 'title' && name === 'title') { title = text; current = '' }
      if (current === 'style' && name === 'style') { css(text); current = '' }
      if (current === 'metadata' && name === 'script') {
        let parsed: unknown
        try { parsed = JSON.parse(text) }
        catch { invalid('Invalid JSON in openape-report metadata') }
        embedded = object(parsed, ['category', 'tags', 'metadata']); current = ''
      }
    },
  }, { decodeEntities: true })
  parser.end(html)
  if (!hasHtml) invalid('Publish a complete HTML document with an html element')
  return { html, ...normalizeMetadata({ title, language, ...embedded, ...overrides }), externalImages: [...externalImages], externalLinks: [...externalLinks] }
}

export function contentPolicy(externalImages: boolean, viewerOrigin: string) {
  return `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:${externalImages ? ' https:' : ''}; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts; frame-ancestors ${viewerOrigin}; webrtc 'block'`
}

export function lifetime(value: unknown, now: number): number | null {
  const input = object(value, ['permanent', 'expiresIn', 'expiresAt'])
  if (Object.keys(input).length !== 1) invalid('Select exactly one explicit lifetime')
  if (input.permanent === true) return null
  let deadline: number
  if (typeof input.expiresIn === 'string') {
    const match = /^([1-9]\d*)([mhd])$/u.exec(input.expiresIn)
    if (!match) invalid('Use a positive integer duration: 30m, 12h or 7d')
    deadline = now + Number(match[1]) * ({ m: 60000, h: 3600000, d: 86400000 }[match[2]!] ?? 0)
  }
  else if (typeof input.expiresAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(input.expiresAt)) {
    const parts = input.expiresAt.slice(0, 19).split(/[-T:]/u).map(Number)
    const [year, month, day, hour, minute, second] = parts as [number, number, number, number, number, number]
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    if (!days || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) invalid('Expiry contains an invalid calendar date or time')
    deadline = Date.parse(input.expiresAt)
  }
  else {
    invalid('Use a future RFC3339 timestamp with timezone or permanent retention')
  }
  if (!Number.isSafeInteger(deadline) || deadline <= now || deadline > 8640000000000000) invalid('Expiry must be a valid future timestamp')
  return deadline
}
