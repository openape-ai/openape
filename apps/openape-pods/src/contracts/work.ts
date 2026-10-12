import { namespacePath, parseWorkFilter, plainJson } from './domain-data.ts'

/**
 * What a Pod's script promises to produce (issue 1465): the operation it serves, where it finds candidate objects,
 * where its results go, which input fields its result depends on and which rule versions it implements. It never
 * names another Pod, a channel or a next step.
 */
export interface WorkDeclaration {
  operation: string
  input: string
  output: string
  fields: string[]
  filter: Record<string, string | number | boolean | null>
  ruleVersions: number[]
}
export type WorkState = 'ready' | 'claimed' | 'completed' | 'retry_wait' | 'waiting' | 'blocked' | 'unknown' | 'superseded'
export const workStates: WorkState[] = ['ready', 'claimed', 'completed', 'retry_wait', 'waiting', 'blocked', 'unknown', 'superseded']
export const workLimits = { declarations: 8, fields: 16, find: 50, claimsPerRun: 25, scan: 1000, attempts: 5, deferMinMs: 60_000, deferMaxMs: 30 * 86_400_000 } as const

export function parseWorkDeclarations(value: unknown): WorkDeclaration[] {
  const input = plainJson(value)
  if (!Array.isArray(input) || !input.length || input.length > workLimits.declarations) throw new Error(`A script declares 1 to ${workLimits.declarations} work operations`)
  const declarations = input.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid work declaration')
    const item = entry as Record<string, unknown>
    if (Object.keys(item).some(key => !['operation', 'input', 'output', 'fields', 'filter', 'ruleVersions'].includes(key))) throw new Error('Unsupported work declaration field')
    const fields = item.fields ?? []
    if (!Array.isArray(fields) || fields.length > workLimits.fields || fields.some(field => typeof field !== 'string' || !field || field.length > 128) || new Set(fields).size !== fields.length) throw new Error('Work fields name distinct top-level input fields')
    const versions = item.ruleVersions
    if (!Array.isArray(versions) || !versions.length || versions.length > 8 || versions.some(version => !Number.isSafeInteger(version) || Number(version) < 1)) throw new Error('A work declaration lists its supported rule versions')
    const declaration: WorkDeclaration = { operation: namespacePath(item.operation), input: namespacePath(item.input), output: namespacePath(item.output), fields: [...fields as string[]].sort(), filter: parseWorkFilter(item.filter), ruleVersions: [...new Set(versions as number[])].sort((a, b) => a - b) }
    if (declaration.input === declaration.output) throw new Error('A work operation writes another namespace than it reads')
    return declaration
  })
  if (new Set(declarations.map(item => item.operation)).size !== declarations.length) throw new Error('Duplicate work operation')
  return declarations
}
