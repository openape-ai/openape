import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../app/utils/api'
import { useGraph } from '../app/composables/useGraph'

const states = new Map<string, ReturnType<typeof ref>>()

vi.stubGlobal('useState', (key: string, init: () => unknown) => {
  if (!states.has(key)) states.set(key, ref(init()))
  return states.get(key)
})
vi.stubGlobal('useWorkspaces', () => ({ activeId: ref('ws1') }))

vi.mock('../app/utils/api', () => ({
  apiFetch: vi.fn(),
}))

describe('useGraph', () => {
  beforeEach(() => {
    states.clear()
    vi.mocked(apiFetch).mockReset()
  })

  it('shares connected status across callers', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ configured: true, connected: true, mail: 'a@b.c' })
    const first = useGraph()
    await first.reload()
    const second = useGraph()
    expect(second.status.value.connected).toBe(true)
    expect(second.status.value.mail).toBe('a@b.c')
  })
})
