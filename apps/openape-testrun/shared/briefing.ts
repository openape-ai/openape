export interface BriefingSource {
  id: string
  label: string
  collectedAt: string | null
  status: 'fresh' | 'stale' | 'missing' | 'error' | 'partial'
  coverage: string
  total?: number
  limit?: number
  url?: string
  approvalUrl?: string
  approvalCount?: number
}
export interface BriefingEmail {
  id: string
  account: string
  sender: string
  subject: string
  receivedAt: string
  disposition: string
  summary: string
  nextAction: string
  url?: string
  approvalUrl?: string
}
export interface BriefingInformation {
  id: string
  text: string
}
export interface BriefingTopic {
  id: string
  placement: 'focus' | 'information'
  title: string
  summary: string
  rationale: string
  uncertainty: string
  references: { account: string, emailId: string }[]
}
export interface BriefingCoverage {
  sourceId: string
  account: string
  population: 'inbox' | 'open-information'
  status: 'complete' | 'partial' | 'unknown'
  available: number | null
  scanned: number | null
  considered: number | null
  included: number | null
  informationItems: number | null
}
interface BriefingBase {
  type: 'briefing'
  seriesId: string
  editionDate: string
  timezone: 'Europe/Vienna'
  generatedAt: string
  title: string
  overview: string
  importantItems: { id: string, title: string, summary: string, priority: 'high' | 'normal', sourceIds: string[] }[]
  nextActions: { id: string, text: string, dueDate?: string, sourceIds: string[], url?: string }[]
  calendar: { id: string, account: string, title: string, start: string, end: string, allDay: boolean, location: string, url?: string }[]
  issues: { repository: string, number: number, title: string, state: 'open', updatedAt: string, url: string }[]
  sources: BriefingSource[]
  gaps: { sourceId: string, reason: string, lastSuccessAt?: string }[]
}
export interface BriefingV1 extends BriefingBase {
  schemaVersion: 1
  emails: BriefingEmail[]
}
export interface BriefingV2 extends BriefingBase {
  schemaVersion: 2
  emails: (BriefingEmail & { informationItems?: BriefingInformation[] })[]
  topics: BriefingTopic[]
  sourceCoverage: BriefingCoverage[]
}
export type Briefing = BriefingV1 | BriefingV2
