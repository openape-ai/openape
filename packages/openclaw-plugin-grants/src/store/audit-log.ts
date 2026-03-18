import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AuditEntry } from '../types.js'

export class AuditLog {
  private filePath: string | null

  constructor(stateDir?: string) {
    this.filePath = stateDir ? join(stateDir, 'grants', 'audit.jsonl') : null
    if (this.filePath) {
      const dir = dirname(this.filePath)
      if (!existsSync(dir))
        mkdirSync(dir, { recursive: true })
    }
  }

  write(entry: Omit<AuditEntry, 'ts'>): void {
    const full: AuditEntry = {
      ts: new Date().toISOString(),
      ...entry,
    }

    if (this.filePath) {
      appendFileSync(this.filePath, JSON.stringify(full) + '\n')
    }
  }
}
