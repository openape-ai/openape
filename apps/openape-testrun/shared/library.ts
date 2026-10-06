export const LIBRARY_ACCESS = ['private', 'readers', 'team', 'public', 'link'] as const
export interface LibraryItem {
  source: 'html' | 'upload'
  id: string
  href: string
  title: string
  category: string
  tags: string[]
  at: number
  audience: typeof LIBRARY_ACCESS[number]
  team_id: string | null
  author: string
  author_type: 'person' | 'agent' | null
  version: number
  expires_at: number | null
  plan_status: string | null
  test_result: { status: string, passed: number, failed: number } | null
}
export interface LibraryFacets { total: number, all: number, categories: { label: string, count: number }[], tags: { label: string, count: number }[] }
export interface LibraryPage { items: LibraryItem[], next_cursor: string | null, facets?: LibraryFacets }
