import { desc, eq, isNotNull } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { users } from '../database/schema'

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

type UserRow = typeof users.$inferSelect

function rowToAgent(row: UserRow): Agent {
  return {
    id: row.id!,
    email: row.email,
    name: row.name,
    owner: row.owner!,
    approver: row.approver!,
    publicKey: row.publicKey!,
    createdAt: row.createdAt,
    isActive: row.isActive,
  }
}

export function createDrizzleAgentStore(): AgentStore {
  const db = useDb()

  return {
    async create(agent) {
      await db.insert(users).values({
        email: agent.email,
        id: agent.id,
        name: agent.name,
        owner: agent.owner,
        approver: agent.approver,
        type: 'agent',
        publicKey: agent.publicKey,
        isActive: agent.isActive,
        createdAt: agent.createdAt,
      })
      return agent
    },

    async findById(id) {
      const row = await db.select().from(users).where(eq(users.id, id)).get()
      if (!row || !row.owner) return null
      return rowToAgent(row)
    },

    async findByEmail(email) {
      const row = await db.select().from(users).where(eq(users.email, email)).get()
      if (!row || !row.owner) return null
      return rowToAgent(row)
    },

    async update(id, data) {
      const existing = await db.select().from(users).where(eq(users.id, id)).get()
      if (!existing || !existing.owner) throw new Error(`Agent not found: ${id}`)

      const updates: Record<string, unknown> = {}
      if (data.email !== undefined) updates.email = data.email
      if (data.name !== undefined) updates.name = data.name
      if (data.owner !== undefined) updates.owner = data.owner
      if (data.approver !== undefined) updates.approver = data.approver
      if (data.publicKey !== undefined) updates.publicKey = data.publicKey
      if (data.isActive !== undefined) updates.isActive = data.isActive

      await db.update(users).set(updates).where(eq(users.id, id))

      const updated = await db.select().from(users).where(eq(users.id, id)).get()
      return rowToAgent(updated!)
    },

    async delete(id) {
      await db.delete(users).where(eq(users.id, id))
    },

    async listAll() {
      const rows = await db.select().from(users).where(isNotNull(users.owner)).orderBy(desc(users.createdAt))
      return rows.map(rowToAgent)
    },

    async findByOwner(owner) {
      const rows = await db.select().from(users).where(eq(users.owner, owner)).orderBy(desc(users.createdAt))
      return rows.map(rowToAgent)
    },

    async findByApprover(approver) {
      const rows = await db.select().from(users).where(eq(users.approver, approver)).orderBy(desc(users.createdAt))
      return rows.map(rowToAgent)
    },
  }
}
