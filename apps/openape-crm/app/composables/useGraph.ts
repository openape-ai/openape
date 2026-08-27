import { apiFetch } from '../utils/api'

export function useGraph() {
  const { activeId } = useWorkspaces()
  const status = ref({ configured: false, connected: false, mail: null as string | null })

  async function reload() {
    try {
      status.value = await apiFetch('/api/graph/status')
    }
    catch {
      status.value = { configured: false, connected: false, mail: null }
    }
  }

  function connect() {
    const ws = activeId.value ? `?workspace_id=${activeId.value}` : ''
    window.location.href = `/api/auth/microsoft${ws}`
  }

  async function disconnect() {
    await apiFetch('/api/graph/disconnect', { method: 'DELETE' })
    await reload()
  }

  return { status, reload, connect, disconnect }
}
