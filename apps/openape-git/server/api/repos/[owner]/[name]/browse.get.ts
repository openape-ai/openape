import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3'
import {
  findReadme,
  isMarkdownPath,
  isValidRef,
  isValidTreePath,
  langFromPath,
  looksBinary,
} from '../../../../utils/git-parse'
import { listCommits, listTree, objectType, readBlob, resolveCommit } from '../../../../utils/git-read'
import { highlightCode, renderMarkdown } from '../../../../utils/render'
import { requireRepoRead } from '../../../../utils/repo-access'
import { repoDiskPath } from '../../../../utils/repos'

// Above this we still show text, but skip shiki (tokenizing megabytes is
// pointless); above MAX_TEXT we stop returning content entirely.
const MAX_HIGHLIGHT = 512 * 1024
const MAX_TEXT = 2 * 1024 * 1024
const MAX_README = 512 * 1024

/**
 * GET /api/repos/:owner/:name/browse?ref=&path= — one endpoint for the code
 * browser. Answers a tree listing (plus rendered README when present), a
 * rendered blob, or `empty` for a repo without commits. Paths are only ever
 * used inside a `<sha>:<path>` object spec — never as filesystem paths.
 */
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const repo = await requireRepoRead(event, owner, name)

  const query = getQuery(event)
  const ref = typeof query.ref === 'string' && query.ref ? query.ref : repo.defaultBranch
  const path = typeof query.path === 'string' ? query.path.replace(/\/+$/, '') : ''
  if (!isValidRef(ref))
    throw createError({ statusCode: 400, statusMessage: 'invalid ref' })
  if (path && !isValidTreePath(path))
    throw createError({ statusCode: 400, statusMessage: 'invalid path' })

  const dir = repoDiskPath(owner, name)
  const sha = await resolveCommit(dir, ref)
  if (!sha) {
    if (path) throw createError({ statusCode: 404, statusMessage: 'ref not found' })
    return { type: 'empty' as const, ref, defaultBranch: repo.defaultBranch }
  }

  const spec = path ? `${sha}:${path}` : sha
  const type = await objectType(dir, spec)
  if (!type)
    throw createError({ statusCode: 404, statusMessage: 'path not found' })

  if (type === 'blob') {
    const buf = await readBlob(dir, spec)
    const base = { type: 'blob' as const, ref, path, size: buf.length }
    if (looksBinary(buf)) return { ...base, binary: true as const }
    if (buf.length > MAX_TEXT) return { ...base, binary: false as const, tooLarge: true as const }
    const text = buf.toString('utf8')
    if (isMarkdownPath(path))
      return { ...base, binary: false as const, rendered: 'markdown' as const, html: renderMarkdown(text) }
    const lang = buf.length > MAX_HIGHLIGHT ? 'text' : langFromPath(path)
    return { ...base, binary: false as const, rendered: 'code' as const, lang, html: await highlightCode(text, lang) }
  }

  const entries = await listTree(dir, spec)
  const readmeEntry = findReadme(entries)
  let readme: { name: string, html: string } | null = null
  if (readmeEntry) {
    const readmePath = path ? `${path}/${readmeEntry.name}` : readmeEntry.name
    const buf = await readBlob(dir, `${sha}:${readmePath}`)
    if (!looksBinary(buf) && buf.length <= MAX_README)
      readme = { name: readmeEntry.name, html: renderMarkdown(buf.toString('utf8')) }
  }
  const [latest] = path ? [null] : await listCommits(dir, sha, 1)
  return { type: 'tree' as const, ref, path, sha, entries, readme, latestCommit: latest ?? null }
})
