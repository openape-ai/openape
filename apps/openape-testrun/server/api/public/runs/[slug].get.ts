import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { assets } from '../../../database/schema'
import { createProblemError } from '../../../utils/problem'
import { renderMarkdown, renderMarkdownInline } from '../../../utils/markdown'
import { loadRunBySlug } from '../../../utils/run-access'
import type { RunManifest } from '../../../utils/run-shape'

/**
 * GET /api/public/runs/:slug — render-ready report data, NO auth.
 *
 * The slug is an unguessable capability token; whoever has the link can view
 * the report. Markdown is rendered server-side (escaped — uploads can never
 * inject HTML); `shot` paths are rewritten to public asset URLs.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createProblemError({ status: 400, title: 'Slug required' })
  const run = await loadRunBySlug(slug)
  const manifest = JSON.parse(run.manifest) as RunManifest

  const db = useDb()
  const uploadedPaths = new Set(
    (await db.select({ path: assets.path }).from(assets).where(eq(assets.runId, run.id))).map(a => a.path),
  )
  const assetUrl = (shot: string) => `/api/public/runs/${run.slug}/assets/${shot}`

  return {
    title: run.title,
    project: run.project,
    status: run.status,
    passed: run.passedCount,
    failed: run.failedCount,
    skipped: run.skippedCount,
    summary_html: renderMarkdown(run.summary),
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    created_by: run.createdBy,
    created_by_act: run.createdByAct,
    created_at: run.createdAt,
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
