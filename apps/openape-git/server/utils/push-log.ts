import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Reader for the per-repo push log the pre-receive hook appends
// ($GIT_DIR/ape-pushes.jsonl): who pushed which commit, as whom.

export interface PushRecord {
  email: string
  act: 'human' | 'agent'
  delegator?: string
  ts: number
}

/** Pure JSONL parse, exported for tests. Later lines win (re-push). */
export function parsePushLog(jsonl: string): Map<string, PushRecord> {
  const map = new Map<string, PushRecord>()
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line) as { sha?: string, email?: string, act?: string, delegator?: string, ts?: number }
      if (typeof rec.sha !== 'string' || typeof rec.email !== 'string') continue
      map.set(rec.sha, {
        email: rec.email,
        act: rec.act === 'human' ? 'human' : 'agent',
        ...(typeof rec.delegator === 'string' ? { delegator: rec.delegator } : {}),
        ts: typeof rec.ts === 'number' ? rec.ts : 0,
      })
    }
    catch {
      // a torn line (concurrent append) is skipped, not fatal
    }
  }
  return map
}

export async function readPushLog(repoDir: string): Promise<Map<string, PushRecord>> {
  try {
    return parsePushLog(await readFile(join(repoDir, 'ape-pushes.jsonl'), 'utf8'))
  }
  catch {
    return new Map()
  }
}
