import type { Briefing, BriefingSource, BriefingV1, BriefingV2 } from '../../shared/briefing'
import { createProblemError } from './problem'

function invalid(field: string): never {
  throw createProblemError({ status: 400, title: 'Invalid briefing', detail: `Invalid ${field}.` })
}
function object(value: unknown, keys: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !keys.includes(key))) invalid(`${field} field`)
  return record
}
function text(value: unknown, field: string, max = 2000, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) invalid(field)
  return value
}
function choice<T extends string>(value: unknown, choices: T[], field: string): T {
  if (!choices.includes(value as T)) invalid(field)
  return value as T
}
function date(value: unknown, field: string): string {
  const result = text(value, field, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) invalid(field)
  return result
}
function timestamp(value: unknown, field: string): string {
  const result = text(value, field, 40)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) invalid(field)
  date(result.slice(0, 10), field)
  return result
}
function link(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const result = text(value, 'source URL', 2000)
  let url: URL
  try { url = new URL(result) }
  catch { return invalid('source URL') }
  if (url.protocol !== 'https:' || url.username || url.password) invalid('source URL')
  return result
}
function count(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(field)
  return value as number
}
function items<T>(value: unknown, max: number, field: string, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) invalid(field)
  return value.map(parse)
}

export function validateBriefing(raw: unknown): Briefing {
  const version = raw && typeof raw === 'object' && 'schemaVersion' in raw ? raw.schemaVersion : undefined
  const additions = version === 2 ? ['topics', 'sourceCoverage'] : []
  const b = object(raw, [...additions, 'schemaVersion', 'type', 'seriesId', 'editionDate', 'timezone', 'generatedAt', 'title', 'overview', 'importantItems', 'nextActions', 'calendar', 'emails', 'issues', 'sources', 'gaps'], 'briefing')
  if ((version !== 1 && version !== 2) || b.type !== 'briefing' || b.timezone !== 'Europe/Vienna') invalid('schema, type or timezone')
  const sources = items(b.sources, 20, 'sources', (rawSource): BriefingSource => {
    const s = object(rawSource, ['id', 'label', 'collectedAt', 'status', 'coverage', 'total', 'limit', 'url', 'approvalUrl', 'approvalCount'], 'source')
    return { id: text(s.id, 'source ID', 100), label: text(s.label, 'source label', 300), collectedAt: s.collectedAt === null ? null : timestamp(s.collectedAt, 'source collectedAt'), status: choice(s.status, ['fresh', 'stale', 'missing', 'error', 'partial'], 'source status'), coverage: text(s.coverage, 'coverage', 2000, true), ...(s.total === undefined ? {} : { total: count(s.total, 'total') }), ...(s.limit === undefined ? {} : { limit: count(s.limit, 'limit') }), url: link(s.url), approvalUrl: link(s.approvalUrl), ...(s.approvalCount === undefined ? {} : { approvalCount: count(s.approvalCount, 'approval count') }) }
  })
  const sourceIds = new Set(sources.map(s => s.id))
  if (sourceIds.size !== sources.length) invalid('duplicate source IDs')
  const sourceId = (value: unknown) => { const id = text(value, 'source ID', 100); if (!sourceIds.has(id)) invalid('source reference'); return id }
  const references = (value: unknown) => items(value, 20, 'source IDs', sourceId)
  const briefing: BriefingV1 = {
    schemaVersion: 1,
    type: 'briefing',
    timezone: 'Europe/Vienna',
    seriesId: text(b.seriesId, 'seriesId', 100),
    editionDate: date(b.editionDate, 'editionDate'),
    generatedAt: timestamp(b.generatedAt, 'generatedAt'),
    title: text(b.title, 'title', 300),
    overview: text(b.overview, 'overview'),
    sources,
    importantItems: items(b.importantItems, 50, 'important items', (value) => {
      const i = object(value, ['id', 'title', 'summary', 'priority', 'sourceIds'], 'important item')
      return { id: text(i.id, 'ID', 200), title: text(i.title, 'title', 300), summary: text(i.summary, 'summary'), priority: choice(i.priority, ['high', 'normal'], 'priority'), sourceIds: references(i.sourceIds) }
    }),
    nextActions: items(b.nextActions, 50, 'next actions', (value) => {
      const a = object(value, ['id', 'text', 'dueDate', 'sourceIds', 'url'], 'action')
      return { id: text(a.id, 'ID', 200), text: text(a.text, 'action'), dueDate: a.dueDate === undefined ? undefined : date(a.dueDate, 'due date'), sourceIds: references(a.sourceIds), url: link(a.url) }
    }),
    calendar: items(b.calendar, 100, 'calendar', (value) => {
      const c = object(value, ['id', 'account', 'title', 'start', 'end', 'allDay', 'location', 'url'], 'event')
      if (typeof c.allDay !== 'boolean') invalid('allDay')
      const parseTime = c.allDay ? date : timestamp
      const start = parseTime(c.start, 'event start'); const end = parseTime(c.end, 'event end')
      if (Date.parse(end) < Date.parse(start)) invalid('event end')
      return { id: text(c.id, 'ID', 500), account: text(c.account, 'account', 300), title: text(c.title, 'title', 300), start, end, allDay: c.allDay, location: text(c.location, 'location', 500, true), url: link(c.url) }
    }),
    emails: items(b.emails, 20, 'emails', (value) => {
      const e = object(value, [...(version === 2 ? ['informationItems'] : []), 'id', 'account', 'sender', 'subject', 'receivedAt', 'disposition', 'summary', 'nextAction', 'url', 'approvalUrl'], 'email')
      return {
        id: text(e.id, 'ID', 1000),
        account: text(e.account, 'account', 300),
        sender: text(e.sender, 'sender', 500),
        subject: text(e.subject, 'subject', 300),
        receivedAt: timestamp(e.receivedAt, 'receivedAt'),
        disposition: text(e.disposition, 'disposition', 100),
        summary: text(e.summary, 'summary'),
        nextAction: text(e.nextAction, 'next action', 2000, true),
        url: link(e.url),
        approvalUrl: link(e.approvalUrl),
        ...(e.informationItems === undefined
          ? {}
          : {
              informationItems: items(e.informationItems, 100, 'information items', (value) => {
                const info = object(value, ['id', 'text'], 'information item')
                return { id: text(info.id, 'information ID', 200), text: text(info.text, 'information text', 16000) }
              }),
            }),
      }
    }),
    issues: items(b.issues, 50, 'issues', (value) => {
      const i = object(value, ['repository', 'number', 'title', 'state', 'updatedAt', 'url'], 'issue')
      const url = link(i.url); if (!url) invalid('issue URL')
      return { repository: text(i.repository, 'repository', 300), number: count(i.number, 'issue number'), title: text(i.title, 'title', 300), state: choice(i.state, ['open'], 'issue state'), updatedAt: timestamp(i.updatedAt, 'updatedAt'), url }
    }),
    gaps: items(b.gaps, 20, 'gaps', (value) => {
      const g = object(value, ['sourceId', 'reason', 'lastSuccessAt'], 'gap')
      return { sourceId: sourceId(g.sourceId), reason: text(g.reason, 'gap reason'), lastSuccessAt: g.lastSuccessAt === undefined ? undefined : timestamp(g.lastSuccessAt, 'last success') }
    }),
  }
  const generationDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(briefing.generatedAt))
  if (generationDate !== briefing.editionDate) invalid('generation date')
  return version === 2 ? validatePresentation(b, briefing) : briefing
}

function validatePresentation(raw: Record<string, unknown>, base: BriefingV1): BriefingV2 {
  if (base.importantItems.length || base.nextActions.length) invalid('v2 actions')
  const emails = base.emails as BriefingV2['emails']
  const key = (account: string, id: string) => JSON.stringify([account, id])
  const emailKeys = new Set(emails.map(mail => key(mail.account, mail.id)))
  if (emailKeys.size !== emails.length) invalid('duplicate emails')
  const informationIds = emails.flatMap(mail => mail.informationItems?.map(item => item.id) ?? [])
  if (new Set(informationIds).size !== informationIds.length) invalid('duplicate information IDs')
  const covered = new Set<string>()
  const topics = items(raw.topics, 20, 'topics', (value) => {
    const topic = object(value, ['id', 'placement', 'title', 'summary', 'rationale', 'uncertainty', 'references'], 'topic')
    const references = items(topic.references, 20, 'topic references', (value) => {
      const ref = object(value, ['account', 'emailId'], 'topic reference')
      const account = text(ref.account, 'reference account', 300)
      const emailId = text(ref.emailId, 'reference email ID', 1000)
      const id = key(account, emailId)
      if (!emailKeys.has(id) || covered.has(id)) invalid('missing or repeated topic reference')
      covered.add(id)
      return { account, emailId }
    })
    if (!references.length) invalid('empty topic references')
    return { id: text(topic.id, 'topic ID', 200), placement: choice(topic.placement, ['focus', 'information'], 'topic placement'), title: text(topic.title, 'topic title', 300), summary: text(topic.summary, 'topic summary'), rationale: text(topic.rationale, 'topic rationale', 2000, true), uncertainty: text(topic.uncertainty, 'topic uncertainty', 2000, true), references }
  })
  if (covered.size !== emailKeys.size) invalid('unrepresented email')
  if (new Set(topics.map(topic => topic.id)).size !== topics.length) invalid('duplicate topic IDs')
  if (topics.filter(topic => topic.placement === 'focus').length > 3) invalid('focus topic limit')
  const nullableCount = (value: unknown, name: string) => value === null ? null : count(value, name)
  const sourceCoverage = items(raw.sourceCoverage, 20, 'source coverage', (value) => {
    const c = object(value, ['sourceId', 'account', 'population', 'status', 'available', 'scanned', 'considered', 'included', 'informationItems'], 'source coverage')
    const sourceId = text(c.sourceId, 'coverage source ID', 100)
    if (!base.sources.some(source => source.id === sourceId)) invalid('coverage source reference')
    const account = text(c.account, 'coverage account', 300)
    const population = choice(c.population, ['inbox', 'open-information'], 'coverage population')
    const status = choice(c.status, ['complete', 'partial', 'unknown'], 'coverage status')
    const counts = { available: nullableCount(c.available, 'available'), scanned: nullableCount(c.scanned, 'scanned'), considered: nullableCount(c.considered, 'considered'), included: nullableCount(c.included, 'included'), informationItems: nullableCount(c.informationItems, 'informationItems') }
    const rows = emails.filter(mail => mail.account === account)
    if (counts.included !== rows.length) invalid('included mail count')
    if (population === 'open-information' && (rows.some(mail => !mail.informationItems?.length) || counts.informationItems !== rows.reduce((sum, mail) => sum + (mail.informationItems?.length ?? 0), 0))) invalid('included information count')
    if (population === 'inbox' && counts.informationItems !== null) invalid('unassessed information count')
    const ordered = [counts.available, counts.scanned, counts.considered, counts.included]
    for (let i = 1; i < ordered.length; i++) {
      const current = ordered[i]; const previous = ordered[i - 1]
      if (current !== null && previous !== null && current !== undefined && previous !== undefined && current > previous) invalid('coverage count order')
    }
    if (status === 'complete' && (ordered.includes(null) || counts.available !== counts.included)) invalid('complete coverage')
    return { sourceId, account, population, status, ...counts }
  })
  if (new Set(sourceCoverage.map(source => source.account)).size !== sourceCoverage.length) invalid('duplicate coverage account')
  if (emails.some(mail => !sourceCoverage.some(source => source.account === mail.account))) invalid('missing mail coverage')
  return { ...base, schemaVersion: 2, emails, topics, sourceCoverage }
}
