import type { PlanDocument } from './render-types'
import { invalid } from '@openape/report-contracts/html'

function object(value: unknown, field: string, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} must be an object`)
  const unknown = Object.keys(value).find(key => !fields.includes(key))
  if (unknown) invalid(`${field}.${unknown} is not supported`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, required = true): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || !value.trim() || value.length > 20000) invalid(`${field} must be nonempty text of at most 20000 characters`)
  return value.trim()
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field)
}

function choice<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid(`${field} must be one of: ${choices.join(', ')}`)
  return value as T
}

function list(value: unknown, field: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 200) invalid(`${field} must be an array of at most 200 items`)
  return value
}

function texts(value: unknown, field: string): string[] {
  return list(value, field).map((item, index) => text(item, `${field}[${index}]`))
}

export function validatePlan(raw: unknown): PlanDocument {
  const plan = object(raw, 'plan', ['schema', 'title', 'goal', 'status', 'project', 'owner', 'date', 'context', 'approval', 'decisions', 'milestones', 'scope', 'nonGoals', 'risks', 'verification', 'changelog', 'links'])
  if (plan.schema !== 'openape.plan/1') invalid('schema must be openape.plan/1')
  if (typeof plan.title === 'string' && plan.title.trim().length > 300) invalid('title must be at most 300 characters')
  const milestones = list(plan.milestones, 'milestones').map((value, index) => {
    const field = `milestones[${index}]`
    const item = object(value, field, ['title', 'goal', 'status', 'steps', 'acceptance', 'proof', 'rollback'])
    const acceptance = texts(item.acceptance, `${field}.acceptance`)
    if (!acceptance.length) invalid(`${field}.acceptance must not be empty`)
    return {
      title: text(item.title, `${field}.title`), goal: text(item.goal, `${field}.goal`),
      status: choice(item.status, `${field}.status`, ['planned', 'active', 'done', 'blocked']),
      steps: texts(item.steps, `${field}.steps`), acceptance,
      proof: optionalText(item.proof, `${field}.proof`), rollback: optionalText(item.rollback, `${field}.rollback`),
    }
  })
  if (!milestones.length) invalid('milestones must not be empty')
  const approval = plan.approval === undefined ? undefined : object(plan.approval, 'approval', ['by', 'date', 'reference'])
  return {
    schema: 'openape.plan/1', title: text(plan.title, 'title'), goal: text(plan.goal, 'goal'),
    status: choice(plan.status, 'status', ['draft', 'active', 'done', 'archived']),
    project: optionalText(plan.project, 'project'), owner: optionalText(plan.owner, 'owner'), date: optionalText(plan.date, 'date'), context: optionalText(plan.context, 'context'),
    decisions: list(plan.decisions, 'decisions').map((value, index) => {
      const field = `decisions[${index}]`
      const item = object(value, field, ['title', 'description', 'status', 'by', 'date'])
      return { title: text(item.title, `${field}.title`), description: text(item.description, `${field}.description`), status: choice(item.status, `${field}.status`, ['proposed', 'accepted', 'rejected']), by: optionalText(item.by, `${field}.by`), date: optionalText(item.date, `${field}.date`) }
    }),
    milestones, scope: texts(plan.scope, 'scope'), nonGoals: texts(plan.nonGoals, 'nonGoals'),
    risks: list(plan.risks, 'risks').map((value, index) => {
      const field = `risks[${index}]`
      const item = object(value, field, ['title', 'mitigation'])
      return { title: text(item.title, `${field}.title`), mitigation: text(item.mitigation, `${field}.mitigation`) }
    }),
    verification: texts(plan.verification, 'verification'),
    changelog: list(plan.changelog, 'changelog').map((value, index) => {
      const field = `changelog[${index}]`
      const item = object(value, field, ['date', 'text'])
      return { date: text(item.date, `${field}.date`), text: text(item.text, `${field}.text`) }
    }),
    links: list(plan.links, 'links').map((value, index) => {
      const field = `links[${index}]`
      const item = object(value, field, ['title', 'url'])
      const url = text(item.url, `${field}.url`)
      let parsed: URL
      try { parsed = new URL(url) }
      catch { return invalid(`${field}.url must be an absolute HTTPS URL`) }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) invalid(`${field}.url must use HTTPS without credentials`)
      return { title: text(item.title, `${field}.title`), url }
    }),
    ...(approval ? { approval: { by: text(approval.by, 'approval.by'), date: text(approval.date, 'approval.date'), reference: text(approval.reference, 'approval.reference') } } : {}),
  }
}
