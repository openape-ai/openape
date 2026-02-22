import { useAppStorage } from './storage'

export interface Agent {
  id: string
  name: string
  owner: string
  approver: string
  publicKey: string
  createdAt: number
  isActive: boolean
}

export interface AgentStore {
  create: (agent: Agent) => Promise<Agent>
  findById: (id: string) => Promise<Agent | null>
  update: (id: string, data: Partial<Omit<Agent, 'id' | 'createdAt'>>) => Promise<Agent>
  delete: (id: string) => Promise<void>
  listAll: () => Promise<Agent[]>
  findByOwner: (owner: string) => Promise<Agent[]>
  findByApprover: (approver: string) => Promise<Agent[]>
}

export function createAgentStore(): AgentStore {
  const storage = useAppStorage()

  return {
    async create(agent) {
      await storage.setItem(`agents:${agent.id}`, agent)
      return agent
    },

    async findById(id) {
      return await storage.getItem<Agent>(`agents:${id}`) ?? null
    },

    async update(id, data) {
      const agent = await storage.getItem<Agent>(`agents:${id}`)
      if (!agent)
        throw new Error(`Agent not found: ${id}`)
      const updated = { ...agent, ...data }
      await storage.setItem(`agents:${id}`, updated)
      return updated
    },

    async delete(id) {
      await storage.removeItem(`agents:${id}`)
    },

    async listAll() {
      const keys = await storage.getKeys('agents:')
      const agents: Agent[] = []
      for (const key of keys) {
        const agent = await storage.getItem<Agent>(key)
        if (agent)
          agents.push(agent)
      }
      return agents.sort((a, b) => b.createdAt - a.createdAt)
    },

    async findByOwner(owner) {
      const all = await this.listAll()
      return all.filter(a => a.owner === owner)
    },

    async findByApprover(approver) {
      const all = await this.listAll()
      return all.filter(a => a.approver === approver)
    },
  }
}
