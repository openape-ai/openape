import { and, desc, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { assets, documentPublications, reportPublications, runVersions, runs } from '../../../database/schema'
import { createProblemError } from '../../../utils/problem'
import { renderMarkdown, renderMarkdownInline } from '../../../utils/markdown'
import { loadRunBySlug, requestedVersion } from '../../../utils/run-access'
import type { RunManifest } from '../../../utils/run-shape'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createProblemError({ status: 400, title: 'Slug required' })
  const run = await loadRunBySlug(event, slug)
  const version = requestedVersion(event, run)
  const db = useDb()

  if (run.reportType === 'document') {
    const document = await db.select().from(documentPublications).where(eq(documentPublications.id, run.id)).get()
    if (!document) throw createProblemError({ status: 404, title: 'Document not found' })
    const editions = document.seriesId
      ? await db.select({ id: documentPublications.id, version: documentPublications.version, title: runs.title, slug: runs.slug }).from(documentPublications).innerJoin(runs, eq(runs.id, documentPublications.id)).where(and(eq(documentPublications.seriesId, document.seriesId), eq(documentPublications.owner, run.createdBy))).orderBy(desc(documentPublications.version))
      : []
    return { type: 'document' as const, title: run.title, category: document.category ?? 'Uncategorized', language: document.language, version: document.version, editions, documentUrl: `/api/public/runs/${run.slug}/document`, artifactDigest: document.artifactDigest, policyVersion: document.policyVersion }
  }

  let shown: Pick<typeof run, 'title' | 'project' | 'summary' | 'status' | 'passedCount' | 'failedCount' | 'skippedCount' | 'manifest' | 'startedAt' | 'finishedAt' | 'createdAt'> = run
  if (version !== run.version) {
    const archived = await db.select().from(runVersions).where(and(eq(runVersions.runId, run.id), eq(runVersions.version, version))).get()
    if (!archived) throw createProblemError({ status: 404, title: 'Version not found' })
    shown = archived
  }
  if (run.reportType === 'briefing') {
    const editions = await db.select({ version: reportPublications.version, date: reportPublications.editionDate }).from(reportPublications).where(eq(reportPublications.seriesId, run.id)).orderBy(desc(reportPublications.version))
    return { type: 'briefing' as const, briefing: JSON.parse(shown.manifest) as import('../../../../shared/briefing').Briefing, version, latest_version: run.version, editions }
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
    type: 'test' as const,
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
