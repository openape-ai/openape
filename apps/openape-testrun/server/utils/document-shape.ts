import type { DocumentAsset, ReportDocument } from '../../shared/document'
import { createHash } from 'node:crypto'
import { createProblemError } from './problem'
import { rasterContentType } from './raster-image'

export const documentBodyLimit = 6 * 1024 * 1024

function invalid(detail: string): never {
  throw createProblemError({ status: 400, title: 'Invalid document', detail })
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('An object is required')
  if (Object.keys(value).some(key => !keys.includes(key))) invalid('Unknown field')
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, name: string) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max || value.includes('\0')) invalid(`${name} must be nonempty UTF-8 text, at most ${max} bytes`)
  return value
}

export function reportCategory(value: unknown) {
  const label = text(value, 160, 'category').trim().normalize('NFC')
  if (/[\p{Cc}\p{Cf}]/u.test(label)) invalid('Category contains control characters')
  return { label, key: createHash('sha256').update(label.toLowerCase()).digest('hex') }
}

function asset(value: unknown): DocumentAsset {
  const entry = object(value, ['name', 'contentType', 'data'])
  if (typeof entry.name !== 'string' || !/^[\w.-]{1,100}$/.test(entry.name)) invalid('Invalid asset name')
  if (typeof entry.data !== 'string' || entry.data.length > 2800000 || !/^[\w+/]*={0,2}$/.test(entry.data)) invalid('Asset must be bounded base64')
  const bytes = Buffer.from(entry.data, 'base64')
  if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== entry.data) invalid('Invalid asset encoding or size')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(entry.contentType)) || rasterContentType(bytes) !== entry.contentType) invalid('Only matching PNG, JPEG or WebP assets are supported')
  return { name: entry.name, contentType: entry.contentType as DocumentAsset['contentType'], data: entry.data }
}

export function validateDocument(value: unknown): ReportDocument {
  const entry = object(value, ['type', 'schemaVersion', 'title', 'html', 'css', 'language', 'category', 'seriesId', 'assets'])
  if (entry.type !== 'document' || entry.schemaVersion !== 1) invalid('Expected document schemaVersion 1')
  const document: ReportDocument = { type: 'document', schemaVersion: 1, title: text(entry.title, 300, 'title'), html: text(entry.html, 256 * 1024, 'html') }
  if (entry.css !== undefined) document.css = text(entry.css, 64 * 1024, 'css')
  if (entry.language !== undefined) {
    if (typeof entry.language !== 'string' || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(entry.language) || entry.language.length > 64) invalid('Invalid language tag')
    document.language = entry.language
  }
  if (entry.category !== undefined) document.category = reportCategory(entry.category).label
  if (entry.seriesId !== undefined) {
    if (typeof entry.seriesId !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(entry.seriesId)) invalid('Invalid series ID')
    document.seriesId = entry.seriesId
  }
  if (entry.assets !== undefined) {
    if (!Array.isArray(entry.assets) || entry.assets.length > 10) invalid('At most ten assets are supported')
    document.assets = entry.assets.map(asset)
    if (new Set(document.assets.map(item => item.name)).size !== document.assets.length) invalid('Duplicate asset name')
    if (document.assets.reduce((size, item) => size + Buffer.from(item.data, 'base64').length, 0) > 4 * 1024 * 1024) invalid('Assets exceed 4 MiB')
  }
  return document
}
