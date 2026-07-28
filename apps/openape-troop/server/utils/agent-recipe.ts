import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { validateCron } from './task-validation'

// Agent Recipe manifest (`ape-agent.yaml`). A recipe is a declarative
// description (this manifest) plus a `tools/` code part in a pinned repo.
// troop parses + validates it, binds capabilities, interpolates deploy-time
// params, schedules the runs. See plans.openape.ai 01KRTAE8 (M1).

export type Result<T>
  = | { ok: true, value: T }
    | { ok: false, reason: string }

const paramSchema = z.object({
  name: z.string().min(1).regex(/^\w+$/, 'param name must be [A-Za-z0-9_]'),
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().optional(),
})

const capabilitySchema = z.object({
  // Placeholder env name the recipe needs (never the value). troop is the
  // broker and owns the lifecycle; `prefer` is a hint only.
  env: z.string().min(1).regex(/^[A-Z][A-Z0-9_]*$/, 'capability env must be UPPER_SNAKE_CASE'),
  prefer: z.enum(['proxy', 'local']).optional(),
  // A recipe that supports several backends (e.g. a coding agent that can
  // target different forges) declares a capability per backend but needs
  // only the one matching the deploy. Optional capabilities are offered,
  // never required: deploy binds them when supplied and skips them
  // otherwise. The agent surfaces a clear runtime error if it later needs
  // a credential that was never bound.
  optional: z.boolean().default(false),
  description: z.string().optional(),
})

const scheduleSchema = z.object({
  cron: z.string().min(1),
  description: z.string().optional(),
  // An explicit shell command for deterministic, LLM-free polling. When
  // set, the agent's cron-runner executes it via the gated ape-shell path
  // (no chat room / no model call) and `description` is the human-readable
  // fallback. `{{param}}` placeholders are interpolated like everything else.
  command: z.string().optional(),
})

const recipeSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/, 'name must be kebab-case'),
  // v1: only `kind: agent` (YAGNI — `kind: script` is a future additive
  // extension, see Decision Log).
  kind: z.literal('agent'),
  intent: z.string().min(1),
  capabilities: z.array(capabilitySchema).default([]),
  params: z.array(paramSchema).default([]),
  // Chat-only agents (e.g. the Operator recipe) legitimately have no schedules.
  schedules: z.array(scheduleSchema).default([]),
  user_addendum: z.boolean().default(false),
  tools: z.array(z.string().min(1)).default([]),
})

export type RecipeParam = z.infer<typeof paramSchema>
export type RecipeCapability = z.infer<typeof capabilitySchema>
export type RecipeSchedule = z.infer<typeof scheduleSchema>
export type AgentRecipe = z.infer<typeof recipeSchema>

export type ParamValue = string | number | boolean

function zodReason(err: z.ZodError): string {
  return err.issues
    .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

export function parseRecipe(yamlText: string): Result<AgentRecipe> {
  let raw: unknown
  try {
    raw = parseYaml(yamlText)
  }
  catch (e) {
    return { ok: false, reason: `invalid YAML: ${(e as Error).message}` }
  }
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'recipe must be a YAML mapping' }
  }

  const parsed = recipeSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, reason: zodReason(parsed.error) }
  }
  const recipe = parsed.data

  for (const s of recipe.schedules) {
    const c = validateCron(s.cron)
    if (!c.ok) return { ok: false, reason: `invalid schedule cron "${s.cron}": ${c.reason}` }
  }

  const seenParam = new Set<string>()
  for (const p of recipe.params) {
    if (seenParam.has(p.name)) return { ok: false, reason: `duplicate param: ${p.name}` }
    seenParam.add(p.name)
  }
  const seenCap = new Set<string>()
  for (const cap of recipe.capabilities) {
    if (seenCap.has(cap.env)) return { ok: false, reason: `duplicate capability: ${cap.env}` }
    seenCap.add(cap.env)
  }

  return { ok: true, value: recipe }
}

// A pinned ref is a commit SHA (7–40 hex) or a version tag (`v1.2.3` /
// `1.2.3`). Floating refs (main, master, HEAD, branch names, latest) are
// rejected — recipe integrity requires a fixed point. (Plan: Ref-Pin Pflicht.)
const SHA_RE = /^[0-9a-f]{7,40}$/i
const VERSION_TAG_RE = /^v?\d+\.\d+\.\d+(?:[-+.]\w[\w.-]*)?$/

export function parseRepoRef(spec: string): Result<{ repo: string, ref: string }> {
  const at = spec.lastIndexOf('@')
  // lastIndexOf('@') > 0 so a leading scope-less spec without ref fails the
  // ref-required branch below rather than splitting on a non-existent '@'.
  if (at <= 0) {
    return { ok: false, reason: `missing pinned ref — use <repo>@<tag|commit>, got "${spec}"` }
  }
  const repo = spec.slice(0, at).trim()
  const ref = spec.slice(at + 1).trim()
  if (!repo) return { ok: false, reason: 'repo is empty' }
  if (!ref) return { ok: false, reason: 'ref is empty — pin to a tag or commit' }
  if (!SHA_RE.test(ref) && !VERSION_TAG_RE.test(ref)) {
    return {
      ok: false,
      reason: `floating ref "${ref}" not allowed — pin to a version tag (v1.2.3) or commit SHA`,
    }
  }
  return { ok: true, value: { repo, ref } }
}

function coerce(value: unknown, type: RecipeParam['type']): Result<ParamValue> {
  if (type === 'string') return { ok: true, value: String(value) }
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return { ok: false, reason: `expected a number, got "${String(value)}"` }
    return { ok: true, value: n }
  }
  // boolean
  if (typeof value === 'boolean') return { ok: true, value }
  if (value === 'true') return { ok: true, value: true }
  if (value === 'false') return { ok: true, value: false }
  return { ok: false, reason: `expected true/false, got "${String(value)}"` }
}

// Validate deploy-time params against the recipe's param defs: apply
// defaults, type-coerce, reject missing-required and unknown keys.
export function resolveParams(
  recipe: AgentRecipe,
  supplied: Record<string, unknown>,
): Result<Record<string, ParamValue>> {
  const defs = new Map(recipe.params.map(p => [p.name, p]))
  for (const key of Object.keys(supplied)) {
    if (!defs.has(key)) return { ok: false, reason: `unknown param: ${key}` }
  }
  const out: Record<string, ParamValue> = {}
  for (const p of recipe.params) {
    if (Object.hasOwn(supplied, p.name)) {
      const c = coerce(supplied[p.name], p.type)
      if (!c.ok) return { ok: false, reason: `param "${p.name}": ${c.reason}` }
      out[p.name] = c.value
      continue
    }
    if (p.default !== undefined) {
      out[p.name] = p.default
      continue
    }
    if (p.required) return { ok: false, reason: `missing required param: ${p.name}` }
  }
  return { ok: true, value: out }
}

const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g

// Replace `{{name}}` with resolved param values. Any placeholder without a
// value is an error — we never deploy a half-interpolated intent.
export function interpolate(
  template: string,
  values: Record<string, ParamValue>,
): Result<string> {
  const missing = new Set<string>()
  const out = template.replace(PLACEHOLDER_RE, (_m, name: string) => {
    if (!(name in values)) {
      missing.add(name)
      return ''
    }
    return String(values[name])
  })
  if (missing.size > 0) {
    return { ok: false, reason: `unresolved placeholder(s): ${[...missing].join(', ')}` }
  }
  return { ok: true, value: out }
}

export interface MaterializedRecipe {
  recipe: AgentRecipe
  params: Record<string, ParamValue>
  intent: string
  schedules: RecipeSchedule[]
  tools: string[]
}

// Full deploy-time materialization: resolve params, then interpolate the
// intent, schedule descriptions and tool entrypoints.
export function materializeRecipe(
  recipe: AgentRecipe,
  supplied: Record<string, unknown>,
): Result<MaterializedRecipe> {
  const p = resolveParams(recipe, supplied)
  if (!p.ok) return p
  const params = p.value

  const intent = interpolate(recipe.intent, params)
  if (!intent.ok) return intent

  const tools: string[] = []
  for (const t of recipe.tools) {
    const r = interpolate(t, params)
    if (!r.ok) return r
    tools.push(r.value)
  }

  const schedules: RecipeSchedule[] = []
  for (const s of recipe.schedules) {
    const desc = s.description ? interpolate(s.description, params) : null
    if (desc && !desc.ok) return desc
    const cmd = s.command ? interpolate(s.command, params) : null
    if (cmd && !cmd.ok) return cmd
    schedules.push({
      cron: s.cron,
      ...(desc ? { description: desc.value } : {}),
      ...(cmd ? { command: cmd.value } : {}),
    })
  }

  return { ok: true, value: { recipe, params, intent: intent.value, schedules, tools } }
}
