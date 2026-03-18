import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GrantApproval, GrantRecord } from '../types.js'
import type { ScopeRiskLevel } from '@openape/core'

export interface CreateGrantInput {
  permission: string
  command: string
  reason?: string
  risk: ScopeRiskLevel
  display: string
}

export class GrantStore {
  private grants = new Map<string, GrantRecord>()
  private filePath: string | null

  constructor(stateDir?: string) {
    this.filePath = stateDir ? join(stateDir, 'grants', 'store.json') : null
    this.load()
  }

  createGrant(input: CreateGrantInput): GrantRecord {
    const grant: GrantRecord = {
      id: randomUUID().slice(0, 8),
      permission: input.permission,
      approval: 'once',
      status: 'pending',
      command: input.command,
      reason: input.reason,
      risk: input.risk,
      display: input.display,
      createdAt: new Date().toISOString(),
    }
    this.grants.set(grant.id, grant)
    this.save()
    return grant
  }

  approveGrant(id: string, approval: GrantApproval, expiresAt?: string): GrantRecord | null {
    const grant = this.grants.get(id)
    if (!grant || grant.status !== 'pending')
      return null

    grant.status = 'approved'
    grant.approval = approval
    grant.decidedAt = new Date().toISOString()
    if (expiresAt)
      grant.expiresAt = expiresAt

    this.save()
    return grant
  }

  denyGrant(id: string): GrantRecord | null {
    const grant = this.grants.get(id)
    if (!grant || grant.status !== 'pending')
      return null

    grant.status = 'denied'
    grant.decidedAt = new Date().toISOString()
    this.save()
    return grant
  }

  consumeGrant(id: string): boolean {
    const grant = this.grants.get(id)
    if (!grant || grant.status !== 'approved')
      return false

    if (grant.approval === 'once') {
      grant.status = 'used'
      grant.usedAt = new Date().toISOString()
      this.save()
    }

    return true
  }

  revokeGrant(id: string): boolean {
    const grant = this.grants.get(id)
    if (!grant || (grant.status !== 'approved' && grant.status !== 'pending'))
      return false

    grant.status = 'revoked'
    this.save()
    return true
  }

  getGrant(id: string): GrantRecord | undefined {
    return this.grants.get(id)
  }

  listGrants(filter?: { status?: GrantRecord['status'] }): GrantRecord[] {
    const grants = Array.from(this.grants.values())
    if (filter?.status)
      return grants.filter(g => g.status === filter.status)
    return grants
  }

  getActiveGrantCount(): number {
    return Array.from(this.grants.values()).filter(g => g.status === 'approved' || g.status === 'pending').length
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath))
      return

    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      if (Array.isArray(data)) {
        for (const grant of data) {
          this.grants.set(grant.id, grant)
        }
      }
    }
    catch {
      // Start fresh if file is corrupt
    }
  }

  private save(): void {
    if (!this.filePath)
      return

    const dir = dirname(this.filePath)
    if (!existsSync(dir))
      mkdirSync(dir, { recursive: true })

    writeFileSync(this.filePath, JSON.stringify(Array.from(this.grants.values()), null, 2))
  }
}
