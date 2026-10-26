import { z } from 'zod'

export const jobSchema = z.object({
  schema: z.literal('openape.codex-job/1'),
  key: z.string().min(1).max(200),
  cwd: z.string().startsWith('/'),
  model: z.string().min(1).max(100),
  sandbox: z.enum(['read-only', 'danger-full-access']),
  approvalPolicy: z.literal('never'),
  prompt: z.string().min(1).max(100_000),
  maxAgeSeconds: z.number().int().min(60).max(604800),
}).strict()

export type Job = z.infer<typeof jobSchema>
export interface Rpc {
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>
  close: () => void
}
export const startSchema = z.object({
  thread: z.object({ id: z.string().min(1) }),
  model: z.string(),
  cwd: z.string(),
  approvalPolicy: z.unknown(),
  sandbox: z.object({ type: z.string() }),
})
export const turnSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['inProgress', 'completed', 'interrupted', 'failed']),
  items: z.array(z.unknown()).default([]),
})
export const readSchema = z.object({
  thread: z.object({ id: z.string(), cwd: z.string(), turns: z.array(turnSchema) }),
})
export const intentSchema = z.object({
  schema: z.literal('openape.codex-receipt/1'),
  digest: z.string(),
  job: jobSchema,
  requestedAt: z.string().datetime(),
  settleBy: z.string().datetime(),
})
export type Intent = z.infer<typeof intentSchema>
