// Shared story-status metadata for the board and detail views. Mirrors the
// server-side STORY_STATUSES (server/utils/stories.ts) — the lifecycle the
// app reflects without interpreting (draft → … → documented).

export const STORY_STATUSES = ['draft', 'consistent', 'approved', 'red', 'green', 'documented'] as const
export type StoryStatus = (typeof STORY_STATUSES)[number]

type BadgeColor = 'neutral' | 'info' | 'primary' | 'warning' | 'success'

export const STORY_STATUS_META: Record<StoryStatus, { label: string, color: BadgeColor }> = {
  draft: { label: 'Draft', color: 'neutral' },
  consistent: { label: 'Consistent', color: 'info' },
  approved: { label: 'Approved', color: 'primary' },
  red: { label: 'Red', color: 'warning' },
  green: { label: 'Green', color: 'success' },
  documented: { label: 'Documented', color: 'success' },
}

export function statusLabel(status: string): string {
  return STORY_STATUS_META[status as StoryStatus]?.label ?? status
}

export function statusColor(status: string): BadgeColor {
  return STORY_STATUS_META[status as StoryStatus]?.color ?? 'neutral'
}
