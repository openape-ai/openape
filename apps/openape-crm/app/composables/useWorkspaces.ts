import { computed } from 'vue'

export interface Workspace {
  id: string
  name: string
  role: 'owner' | 'manager' | 'member'
  created_at: number
}

const STORAGE_KEY = 'openape-crm:workspace'

/**
 * The signed-in user's workspaces plus the one last picked — that lives in
 * localStorage so board, contacts and settings all show the same one.
 */
export function useWorkspaces() {
  const list = useState<Workspace[]>('crm-workspaces', () => [])
  const activeId = useState<string>('crm-workspace-id', () => '')

  const active = computed(() => list.value.find(w => w.id === activeId.value) ?? null)

  async function load() {
    list.value = await $fetch<Workspace[]>('/api/workspaces')
    const stored = import.meta.client ? window.localStorage.getItem(STORAGE_KEY) : null
    const known = list.value.some(w => w.id === stored)
    select(known && stored ? stored : (list.value[0]?.id ?? ''))
  }

  function select(id: string) {
    activeId.value = id
    if (import.meta.client && id) window.localStorage.setItem(STORAGE_KEY, id)
  }

  async function create(name: string) {
    const created = await $fetch<Workspace>('/api/workspaces', { method: 'POST', body: { name } })
    await load()
    select(created.id)
    return created
  }

  return { list, active, activeId, load, select, create }
}
