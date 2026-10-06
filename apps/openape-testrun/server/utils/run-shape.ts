import { validateManifest as parseManifest } from '@openape/report-contracts/run-manifest'
import { ReportError } from '@openape/report-contracts/html'
import { createProblemError } from './problem'

export type { RunManifest, RunStatus, RunStep, RunTest } from '@openape/report-contracts/run-manifest'
export { aggregateStatus, referencedShots } from '@openape/report-contracts/run-manifest'

export function validateManifest(raw: unknown) {
  try { return parseManifest(raw) }
  catch (error) {
    if (error instanceof ReportError) throw createProblemError({ status: 400, title: 'Invalid manifest', detail: error.message })
    throw error
  }
}
