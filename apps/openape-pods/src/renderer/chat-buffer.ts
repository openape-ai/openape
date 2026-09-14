import { ref } from 'vue'
import type { Ref } from 'vue'

const drafts = new Map<string, Ref<string>>()
export function chatDraft(podId: string | null): Ref<string> {
  const key = podId ?? 'workspace'
  const existing = drafts.get(key)
  if (existing) return existing
  const draft = ref(''); drafts.set(key, draft); return draft
}
