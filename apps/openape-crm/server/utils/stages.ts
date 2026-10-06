import type { PipelineStage } from '#shared/stages'
import type { useDb } from '../database/drizzle'
import { and, asc, eq } from 'drizzle-orm'
import { DEFAULT_STAGES, MAX_STAGE_NAME } from '#shared/stages'
import { pipelineStages } from '../database/schema'
import { createProblemError } from './problem'

type Db = ReturnType<typeof useDb>

export function defaultStageRows(workspaceId: string) {
  return DEFAULT_STAGES.map((stage, position) => ({ ...stage, workspaceId, position }))
}

export async function listStages(db: Db, workspaceId: string): Promise<PipelineStage[]> {
  return await db
    .select({
      key: pipelineStages.key,
      name: pipelineStages.name,
      outcome: pipelineStages.outcome,
      position: pipelineStages.position,
    })
    .from(pipelineStages)
    .where(eq(pipelineStages.workspaceId, workspaceId))
    .orderBy(asc(pipelineStages.position))
    .all()
}

/** The stage a deal should go to — including the `outcome` that decides closing. */
export async function requireStage(db: Db, workspaceId: string, key: unknown): Promise<PipelineStage> {
  const stage = typeof key === 'string'
    ? await db
        .select({
          key: pipelineStages.key,
          name: pipelineStages.name,
          outcome: pipelineStages.outcome,
          position: pipelineStages.position,
        })
        .from(pipelineStages)
        .where(and(eq(pipelineStages.workspaceId, workspaceId), eq(pipelineStages.key, key)))
        .get()
    : undefined

  if (!stage) throw createProblemError({ status: 400, title: 'unknown stage' })
  return stage
}

/** The first stage of the pipeline — where a deal lands with nothing specified. */
export async function firstStage(db: Db, workspaceId: string): Promise<PipelineStage> {
  const stages = await listStages(db, workspaceId)
  if (!stages[0]) throw createProblemError({ status: 409, title: 'workspace has no stages' })
  return stages[0]
}

export function parseStageName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > MAX_STAGE_NAME) {
    throw createProblemError({ status: 400, title: `name must be 1–${MAX_STAGE_NAME} chars` })
  }
  return name
}

/** Rewrite positions 0…n — one source of truth instead of gap arithmetic. */
export async function writePositions(db: Db, workspaceId: string, keys: string[]): Promise<void> {
  await Promise.all(keys.map((key, position) =>
    db.update(pipelineStages)
      .set({ position })
      .where(and(eq(pipelineStages.workspaceId, workspaceId), eq(pipelineStages.key, key))),
  ))
}
