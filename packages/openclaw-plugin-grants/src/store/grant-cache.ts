import { cliAuthorizationDetailCovers } from '@openape/core'
import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import type { GrantRecord } from '../types.js'

interface CacheEntry {
  grant: GrantRecord
  detail: OpenApeCliAuthorizationDetail
  expiresAt: number | null
}

export class GrantCache {
  private entries = new Map<string, CacheEntry>()

  put(grant: GrantRecord, detail: OpenApeCliAuthorizationDetail): void {
    if (grant.approval === 'once')
      return // never cache once-grants

    const expiresAt = grant.expiresAt ? new Date(grant.expiresAt).getTime() : null

    this.entries.set(grant.permission, {
      grant,
      detail,
      expiresAt,
    })
  }

  lookup(permission: string, detail: OpenApeCliAuthorizationDetail): GrantRecord | null {
    // Direct match first
    const direct = this.entries.get(permission)
    if (direct) {
      if (this.isExpired(direct)) {
        this.entries.delete(permission)
        return null
      }
      return direct.grant
    }

    // Coverage match: check if any cached grant covers this permission
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(key)
        continue
      }
      if (cliAuthorizationDetailCovers(entry.detail, detail)) {
        return entry.grant
      }
    }

    return null
  }

  remove(permission: string): boolean {
    return this.entries.delete(permission)
  }

  clear(): void {
    this.entries.clear()
  }

  size(): number {
    return this.entries.size
  }

  private isExpired(entry: CacheEntry): boolean {
    if (!entry.expiresAt)
      return false
    return Date.now() > entry.expiresAt
  }
}
