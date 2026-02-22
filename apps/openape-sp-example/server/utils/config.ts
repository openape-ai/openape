import type { AuthFlowState } from '@ddisa/core'

export interface FlowStateStore {
  save(state: string, flow: AuthFlowState): Promise<void>
  find(state: string): Promise<AuthFlowState | null>
  delete(state: string): Promise<void>
}

interface StoredFlowState extends AuthFlowState {
  expiresAt: number
}

// Storage configured via nitro.storage in nuxt.config.ts
// Access with useStorage('db')
const getStorage = () => useStorage('db')

let _flowStateStore: FlowStateStore | null = null

function createFlowStateStore(): FlowStateStore {
  return {
    async save(state, flow) {
      const expiresAt = flow.createdAt + 10 * 60 * 1000 // 10 min TTL
      await getStorage().setItem<StoredFlowState>(`flows:${state}`, { ...flow, expiresAt })
    },

    async find(state) {
      const stored = await getStorage().getItem<StoredFlowState>(`flows:${state}`)
      if (!stored) return null

      if (stored.expiresAt < Date.now()) {
        await getStorage().removeItem(`flows:${state}`)
        return null
      }

      const { expiresAt: _, ...flow } = stored
      return flow
    },

    async delete(state) {
      await getStorage().removeItem(`flows:${state}`)
    },
  }
}

function getFlowStateStore() {
  if (!_flowStateStore) {
    _flowStateStore = createFlowStateStore()
  }
  return _flowStateStore
}

export function getSpConfig() {
  const config = useRuntimeConfig()
  return {
    spId: config.spId || 'sp.example.com',
    openapeUrl: config.openapeUrl || 'http://localhost:3000',
    spName: 'DDISA Sample SP',
  }
}

export const useFlowStateStore = getFlowStateStore
