export interface HtmlReportView {
  document_id: string
  publication_id: string
  version: number
  latest_version: number
  title: string
  category: string | null
  language: string | null
  tags: string[]
  metadata: Record<string, string>
  author: string
  created_at: number
  artifact_digest: string
  policy_version: string
  external_images: string[]
  external_links: string[]
  audience: string
  team_id: string | null
  expires_at: number | null
  access_revision: number
  retention_revision: number
  caller_role: 'owner' | 'admin' | 'editor' | 'reader'
  url: string
  version_url: string
  legacy_plan_id: string | null
}
