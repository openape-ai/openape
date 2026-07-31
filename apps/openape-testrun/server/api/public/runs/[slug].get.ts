import { and, desc, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { assets, runVersions } from '../../../database/schema'
import { createProblemError } from '../../../utils/problem'
import { renderMarkdown, renderMarkdownInline } from '../../../utils/markdown'
import { loadRunBySlug, requestedVersion } from '../../../utils/run-access'
import type { RunManifest } from '../../../utils/run-shape'

/**
 * GET /api/public/runs/:slug — render-ready report data, NO auth.
 *
 * The slug is an unguessable capability token; whoever has the link can view
 * the report. Markdown is rendered server-side (escaped — uploads can never
 * inject HTML); `shot` paths are rewritten to public asset URLs.
 *
 * Series runs keep every uploaded version: the link shows the latest, and
 * ?v=<n> renders an archived version. `versions` lists them newest first.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createProblemError({ status: 400, title: 'Slug required' })
  const run = await loadRunBySlug(slug)
  const version = requestedVersion(event, run)
  const db = useDb()

  let shown: Pick<typeof run, 'title' | 'project' | 'summary' | 'status' | 'passedCount' | 'failedCount' | 'skippedCount' | 'manifest' | 'startedAt' | 'finishedAt' | 'createdAt'> = run
  if (version !== run.version) {
    const archived = await db.select().from(runVersions).where(and(eq(runVersions.runId, run.id), eq(runVersions.version, version))).get()
    if (!archived) throw createProblemError({ status: 404, title: 'Version not found' })
    shown = archived
  }
  const manifest = JSON.parse(shown.manifest) as RunManifest

  const versions = run.series
    ? [
        { version: run.version, status: run.status, created_at: run.createdAt },
        ...(await db.select({ version: runVersions.version, status: runVersions.status, created_at: runVersions.createdAt })
          .from(runVersions)
          .where(eq(runVersions.runId, run.id))
          .orderBy(desc(runVersions.version))),
      ]
    : []

  const uploadedPaths = new Set(
    (await db.select({ path: assets.path }).from(assets).where(and(eq(assets.runId, run.id), eq(assets.version, version)))).map(a => a.path),
  )
  const assetUrl = (shot: string) => `/api/public/runs/${run.slug}/assets/${shot}?v=${version}`

  return {
    title: shown.title,
    project: shown.project,
    status: shown.status,
    passed: shown.passedCount,
    failed: shown.failedCount,
    skipped: shown.skippedCount,
    summary_html: renderMarkdown(shown.summary),
    started_at: shown.startedAt,
    finished_at: shown.finishedAt,
    created_by: run.createdBy,
    created_by_act: run.createdByAct,
    created_at: shown.createdAt,
    version,
    latest_version: run.version,
    versions,
    tests: manifest.tests.map(test => ({
      id: test.id,
      title: test.title,
      status: test.status,
      description_html: renderMarkdown(test.description),
      error_html: renderMarkdown(test.error),
      steps: test.steps.map(step => ({
        title: step.title,
        status: step.status,
        caption_html: renderMarkdownInline(step.caption),
        shot: step.shot && uploadedPaths.has(step.shot) ? assetUrl(step.shot) : null,
      })),
    })),
  }
})
