import { desc, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { agents } from '../database/schema'

interface Agent {
  id: string
  email: string
  name: string
  owner: string
  approver: string
  publicKey: string
  createdAt: number
  isActive: boolean
}

interface AgentStore {
  create: (agent: Agent) => Promise<Agent>
  findById: (id: string) => Promise<Agent | null>
  findByEmail: (email: string) => Promise<Agent | null>
  update: (id: string, data: Partial<Omit<Agent, 'id' | 'createdAt'>>) => Promise<Agent>
  delete: (id: string) => Promise<void>
  listAll: () => Promise<Agent[]>
  findByOwner: (owner: string) => Promise<Agent[]>
  findByApprover: (approver: string) => Promise<Agent[]>
}

type AgentRow = typeof agents.$inferSelect

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    owner: row.owner,
    approver: row.approver,
    publicKey: row.publicKey,
    createdAt: row.createdAt,
    isActive: row.isActive,
  }
}

export function createDrizzleAgentStore(): AgentStore {
  const db = useDb()

  return {
    async create(agent) {
      await db.insert(agents).values({
        id: agent.id,
        email: agent.email,
        name: agent.name,
        owner: agent.owner,
        approver: agent.approver,
        publicKey: agent.publicKey,
        createdAt: agent.createdAt,
        isActive: agent.isActive,
      })
      return agent
    },

    async findById(id) {
      const row = await db.select().from(agents).where(eq(agents.id, id)).get()
      return row ? rowToAgent(row) : null
    },

    async findByEmail(email) {
      const row = await db.select().from(agents).where(eq(agents.email, email)).get()
      return row ? rowToAgent(row) : null
    },

    async update(id, data) {
      const existing = await db.select().from(agents).where(eq(agents.id, id)).get()
      if (!existing) throw new Error(`Agent not found: ${id}`)

      const updates: Record<string, unknown> = {}
      if (data.email !== undefined) updates.email = data.email
      if (data.name !== undefined) updates.name = data.name
      if (data.owner !== undefined) updates.owner = data.owner
      if (data.approver !== undefined) updates.approver = data.approver
      if (data.publicKey !== undefined) updates.publicKey = data.publicKey
      if (data.isActive !== undefined) updates.isActive = data.isActive

      await db.update(agents).set(updates).where(eq(agents.id, id))

      const updated = await db.select().from(agents).where(eq(agents.id, id)).get()
      return rowToAgent(updated!)
    },

    async delete(id) {
      await db.delete(agents).where(eq(agents.id, id))
    },

    async listAll() {
      const rows = await db.select().from(agents).orderBy(desc(agents.createdAt))
      return rows.map(rowToAgent)
    },

    async findByOwner(owner) {
      const rows = await db.select().from(agents).where(eq(agents.owner, owner)).orderBy(desc(agents.createdAt))
      return rows.map(rowToAgent)
    },

    async findByApprover(approver) {
      const rows = await db.select().from(agents).where(eq(agents.approver, approver)).orderBy(desc(agents.createdAt))
      return rows.map(rowToAgent)
    },
  }
}
