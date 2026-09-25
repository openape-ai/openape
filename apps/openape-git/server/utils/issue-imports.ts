import type { H3Event } from 'h3'
import type { issueContext } from './issue-api'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { createError, getQuery, getRouterParam, setHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { issueAttachments, issueComments, importOrigins, issues, legacyReferences } from '../database/schema'
import { readableIssuePredicate } from './issue-access'
import { renderIssueMarkdown } from './render'

type Context = Awaited<ReturnType<typeof issueContext>>
interface Provenance { source: string, sourceKey: string, original_author?: string, user?: { login?: string }, references?: { text: string, key: string, kind: string }[] }

export async function importedAttribution(context: Context, entityId: string) {
  const origin = await context.db.select().from(importOrigins).where(eq(importOrigins.entityId, entityId)).get()
  if (!origin) return null
  const provenance = JSON.parse(origin.provenance) as Provenance
  return { label: `Imported from Forgejo: ${provenance.original_author || provenance.user?.login || 'Ghost'}`, sourceUrl: provenance.sourceKey }
}

export async function importedText(context: Context, entityId: string, body: string) {
  const origin = await context.db.select().from(importOrigins).where(eq(importOrigins.entityId, entityId)).get()
  if (!origin) return { bodyHtml: renderIssueMarkdown(body), imported: null }
  const provenance = JSON.parse(origin.provenance) as Provenance
  const references = provenance.references ?? []
  const mapping: Record<string, string> = {}
  const keys = [...new Set(references.map(reference => reference.key))]
  for (let offset = 0; offset < keys.length; offset += 100) {
    const accessible = await context.db.select({ sourceKey: legacyReferences.sourceKey, issueId: legacyReferences.issueId, commentId: legacyReferences.commentId, kind: legacyReferences.kind }).from(legacyReferences).innerJoin(issues, eq(issues.id, legacyReferences.issueId)).where(and(inArray(legacyReferences.sourceKey, keys.slice(offset, offset + 100)), readableIssuePredicate(context.principal, context.audience)))
    for (const alias of accessible) {
      if (alias.commentId && !await visibleAttachmentComment(context, alias.commentId)) continue
      let destination = `/i/${alias.issueId}${alias.commentId ? `#comment-${alias.commentId}` : ''}`
      if (alias.kind === 'asset') {
        const asset = await context.db.select().from(issueAttachments).where(eq(issueAttachments.issueId, alias.issueId)).all()
        const found = asset.find(item => (JSON.parse(item.provenance) as { browser_download_url: string }).browser_download_url === alias.sourceKey)
        if (!found || !await visibleAttachmentComment(context, found.commentId)) continue
        destination = `/api/issue-attachments/${found.id}`
      }
      for (const reference of references.filter(reference => reference.key === alias.sourceKey)) mapping[reference.text] = destination
    }
  }
  return { bodyHtml: renderIssueMarkdown(body, mapping), imported: { label: `Imported from Forgejo: ${provenance.original_author || provenance.user?.login || 'Ghost'}`, sourceUrl: provenance.sourceKey } }
}

async function visibleAttachmentComment(context: Context, commentId: string | null) {
  if (!commentId) return true
  return Boolean(await context.db.select({ id: issueComments.id }).from(issueComments).where(and(eq(issueComments.id, commentId), eq(issueComments.hidden, 0))).get())
}

export async function attachmentList(context: Context, issueId: string) {
  await context.store.requireIssue(context.db, issueId)
  const rows = await context.db.select().from(issueAttachments).where(eq(issueAttachments.issueId, issueId))
  const visible = []
  for (const row of rows) {
    if (await visibleAttachmentComment(context, row.commentId)) visible.push({ id: row.id, filename: row.filename, size: row.size, commentId: row.commentId, url: `/api/issue-attachments/${row.id}` })
  }
  return visible
}

async function requireImportedIssue(context: Context, id: string, statusMessage: string) {
  try { return await context.store.requireIssue(context.db, id) }
  catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) throw createError({ statusCode: 404, statusMessage })
    throw error
  }
}

export async function downloadIssueAttachment(event: H3Event, context: Context) {
  const id = getRouterParam(event, 'id') ?? ''
  const row = await context.db.select().from(issueAttachments).where(eq(issueAttachments.id, id)).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  await requireImportedIssue(context, row.issueId, 'Attachment not found')
  if (!await visibleAttachmentComment(context, row.commentId)) throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  if (!/^[a-f\d]{64}$/.test(row.storageKey) || row.storageKey !== row.sha256 || row.size > 25 * 1024 * 1024) throw createError({ statusCode: 500, statusMessage: 'Invalid attachment metadata' })
  const root = join(await realpath(resolve(useRuntimeConfig().gitDataDir)), 'issue-assets')
  if (await realpath(root) !== root) throw createError({ statusCode: 500, statusMessage: 'Invalid attachment storage' })
  const file = await open(join(root, row.storageKey), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size !== row.size) throw createError({ statusCode: 500, statusMessage: 'Attachment integrity check failed' })
    const bytes = await file.readFile()
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw createError({ statusCode: 500, statusMessage: 'Attachment integrity check failed' })
    setHeader(event, 'content-type', 'application/octet-stream')
    setHeader(event, 'content-disposition', `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`)
    setHeader(event, 'x-content-type-options', 'nosniff')
    setHeader(event, 'content-security-policy', 'default-src \'none\'; sandbox')
    return bytes
  }
  finally { await file.close() }
}

export async function resolveLegacyIssue(event: H3Event, context: Context) {
  const { url } = getQuery(event)
  if (typeof url !== 'string' || url.length > 4096) throw createError({ statusCode: 400, statusMessage: 'A legacy URL is required' })
  const alias = await context.db.select().from(legacyReferences).where(eq(legacyReferences.sourceKey, url)).get()
  if (!alias || !['issue', 'comment'].includes(alias.kind)) throw createError({ statusCode: 404, statusMessage: 'Legacy issue not found' })
  await requireImportedIssue(context, alias.issueId, 'Legacy issue not found')
  if (alias.commentId && !await visibleAttachmentComment(context, alias.commentId)) throw createError({ statusCode: 404, statusMessage: 'Legacy comment not found' })
  return { url: `/i/${alias.issueId}${alias.commentId ? `#comment-${alias.commentId}` : ''}` }
}
