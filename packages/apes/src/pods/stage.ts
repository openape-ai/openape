import { hash, read, save } from './files'
import { redact, StageFailure } from './invoke'

export async function stage(output: string, metadata: Record<string, unknown>, action: () => Promise<unknown>) {
  const prior = await read(output)
  if (prior?.terminal === true || prior?.status === 'completed') return prior
  try { return await action() }
  catch (error) {
    const typed = error instanceof StageFailure ? error : new StageFailure('unknown', 'validation', String(error))
    const record = {
      ...metadata,
      status: typed.status,
      phase: typed.phase,
      terminal: typed.terminal,
      summary: redact(typed.message),
      links: metadata.links ?? [],
    }
    await save(output, { ...record, outputDigest: hash(record) })
    return record
  }
}
