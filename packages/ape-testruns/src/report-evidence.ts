import type { Evidence, ReportDocument } from './report-types'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { HTML_LIMIT, invalid } from '@openape/report-contracts/html'
import { escapeHtml as e, markdown } from './render-document'

export function digest(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface ResolvedEvidence { id: string, digest?: string, html: string }

function localBytes(path: string, directory: string, limit: number): Buffer {
  if (isAbsolute(path) || path.includes('\\') || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || path.split('/').some(part => part === '..' || part === '.')) invalid(`Evidence requires a relative contained path: ${path}`)
  const base = realpathSync(directory)
  const file = realpathSync(resolve(base, path))
  const local = relative(base, file)
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) invalid(`Evidence escapes the input directory: ${path}`)
  const stat = statSync(file)
  if (!stat.isFile() || stat.size > limit) invalid(`Evidence exceeds ${limit / 1024 / 1024} MiB or is not a file: ${path}`)
  return readFileSync(file)
}

function imageMime(path: string, bytes: Buffer): string {
  const extension = extname(path).toLowerCase()
  if (extension === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (['.jpg', '.jpeg'].includes(extension) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (extension === '.gif' && /^GIF8[79]a$/u.test(bytes.subarray(0, 6).toString())) return 'image/gif'
  if (extension === '.webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return invalid(`Image bytes do not match the raster extension: ${path}`)
}

export function externalLink(item: { title: string, url: string, version?: number, digest?: string }): string {
  return `<a href="${e(item.url)}" rel="noopener noreferrer">${e(item.title)}</a><span class="small"> · ${[item.version ? `Recorded version ${item.version}` : undefined, item.digest ? `SHA-256 ${item.digest}` : undefined, 'External reference · not fetched or frozen locally'].filter(Boolean).map(value => e(value!)).join(' · ')}</span>`
}

function resolveEvidence(item: Evidence, directory: string): ResolvedEvidence {
  const heading = `<h3>${e(item.title)} <span class="status">${e(item.role)}</span></h3>`
  if (item.kind === 'link') return { id: item.id, html: `${heading}<p>${externalLink(item)}</p>` }
  const bytes = item.path ? localBytes(item.path, directory, (item.kind === 'image' ? 8 : 1) * 1024 * 1024) : Buffer.from(item.kind === 'text' ? item.text! : '')
  const hash = digest(bytes)
  if (item.kind === 'text') {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    return { id: item.id, digest: hash, html: `${heading}<pre><code>${e(text)}</code></pre>` }
  }
  if (item.inspection && item.inspection.digest !== hash) invalid(`Inspection digest mismatch for ${item.id}`)
  const inspection = item.inspection ? `<strong>Inspection attestation: ${e(item.inspection.result)}</strong><p>${e(item.inspection.by)} · ${e(item.inspection.at)}</p>${markdown(item.inspection.notes)}<p class="small">Exact image digest matched. Inspector identity is not verified by the renderer.</p>` : '<p>Inspection: not recorded</p>'
  const context = [item.targetId ? `Target: ${item.targetId}` : 'Target: not recorded', item.capturedAt, item.viewport ? `${item.viewport.width} × ${item.viewport.height}` : undefined, item.theme].filter(Boolean).map(value => e(value!)).join(' · ')
  return { id: item.id, digest: hash, html: `${heading}<figure class="screenshot"><div class="sample-window"><div class="sample-toolbar">${context}</div><img src="data:${imageMime(item.path, bytes)};base64,${bytes.toString('base64')}" alt="${e(item.title)}"></div><figcaption>${markdown(item.caption)}${inspection}<p class="small">SHA-256 ${hash}</p></figcaption></figure>` }
}

export function resolveReportEvidence(doc: ReportDocument, directory: string): ResolvedEvidence[] {
  let size = 0
  return (doc.evidence ?? []).map((item) => {
    const resolved = resolveEvidence(item, directory)
    size += Buffer.byteLength(resolved.html)
    if (size > HTML_LIMIT) invalid('Embedded evidence exceeds the 20 MiB report limit')
    return resolved
  })
}
