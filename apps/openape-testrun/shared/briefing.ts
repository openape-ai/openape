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
export interface Briefing {
  schemaVersion: 1
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
  emails: { id: string, account: string, sender: string, subject: string, receivedAt: string, disposition: string, summary: string, nextAction: string, url?: string, approvalUrl?: string }[]
  issues: { repository: string, number: number, title: string, state: 'open', updatedAt: string, url: string }[]
  sources: BriefingSource[]
  gaps: { sourceId: string, reason: string, lastSuccessAt?: string }[]
}
