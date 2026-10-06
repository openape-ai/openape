export interface IssueLabel { id: string, name: string, color: string }
export interface IssueRecord {
  id: string
  number: number | null
  title: string
  body: string
  bodyHtml: string
  imported?: { label: string, sourceUrl: string } | null
  state: 'open' | 'closed'
  version: number
  hidden: number
  triageState: 'classified' | 'unclassified'
  authorSubject: string | null
  authorActor: string | null
  assignee: string | null
  productName: string
  createdAt: number
  updatedAt: number
  labels: IssueLabel[]
  stableUrl: string
  repositoryUrl: string | null
  attachments?: { id: string, filename: string, size: number, commentId: string | null, url: string }[]
  capabilities: { migrationLocked?: boolean, repository: { owner: string, name: string } | null, edit: boolean, triage: boolean, admin: boolean, comment: boolean }
  events?: { id: string, action: string, subject: string, actor: string, createdAt: number }[]
}
export interface IssueComment {
  id: string
  body: string
  bodyHtml: string
  imported?: { label: string, sourceUrl: string } | null
  authorSubject: string | null
  authorActor: string | null
  createdAt: number
  version: number
  canEdit: boolean
}
export interface IssueFacets {
  repositories: { owner: string, name: string }[]
  labels: { id: string, name: string }[]
  products: { key: string, name: string }[]
  assignees: string[]
  canCreate: boolean
}
